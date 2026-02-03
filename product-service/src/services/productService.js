const Product = require('../models/Product');
const { sanitizeProductInput } = require('../utils/inputSanitizer');
const kafkaProducer = require('../kafka/kafkaProducer');
const { v4: uuidv4 } = require('uuid');

class ProductService {
  async getProducts({ search, category, limit = 20, offset = 0 }) {
    const query = { isActive: true };

    if (search) {
      query.$text = { $search: search };
    }

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 });

    return products;
  }

  async getProductById(id) {
    const product = await Product.findById(id);
    if (!product) {
      const error = new Error('Product not found');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }
    return product;
  }

  async getProductsBySeller(sellerId) {
    const products = await Product.find({ sellerId })
      .sort({ createdAt: -1 });
    return products;
  }

  async getCategories() {
    const categories = await Product.distinct('category');
    return categories;
  }

  async createProduct(sellerId, input, correlationId) {
    const sanitizedInput = sanitizeProductInput(input);

    if (!sanitizedInput.name || !sanitizedInput.description || !sanitizedInput.category) {
      const error = new Error('Missing required fields: name, description, and category are required');
      error.code = 'MISSING_FIELDS';
      throw error;
    }

    if (typeof sanitizedInput.basePrice !== 'number' || sanitizedInput.basePrice < 0) {
      const error = new Error('Base price must be a valid positive number');
      error.code = 'INVALID_PRICE';
      throw error;
    }

    if (!sanitizedInput.variants || sanitizedInput.variants.length === 0) {
      const error = new Error('At least one product variant is required');
      error.code = 'MISSING_VARIANTS';
      throw error;
    }

    sanitizedInput.variants.forEach((variant, index) => {
      if (typeof variant.stock !== 'number' || variant.stock < 0) {
        const error = new Error(`Variant ${index + 1} must have a valid stock quantity`);
        error.code = 'INVALID_STOCK';
        throw error;
      }
    });

    const product = new Product({
      ...sanitizedInput,
      sellerId,
    });

    await product.save();

    setImmediate(async () => {
      try {
        await kafkaProducer.publishProductCreated(
          product.toJSON(),
          correlationId || `product-create-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish product created event:', error);
      }
    });

    return product;
  }

  async updateProduct(productId, sellerId, input, correlationId) {
    const product = await Product.findOne({ _id: productId, sellerId });
    if (!product) {
      const error = new Error('Product not found or unauthorized');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const sanitizedInput = sanitizeProductInput(input);

    if (sanitizedInput.variants !== undefined) {
      if (!sanitizedInput.variants || sanitizedInput.variants.length === 0) {
        const error = new Error('At least one product variant is required');
        error.code = 'MISSING_VARIANTS';
        throw error;
      }

      sanitizedInput.variants.forEach((variant, index) => {
        if (typeof variant.stock !== 'number' || variant.stock < 0) {
          const error = new Error(`Variant ${index + 1} must have a valid stock quantity`);
          error.code = 'INVALID_STOCK';
          throw error;
        }
      });
    }

    Object.assign(product, sanitizedInput);
    await product.save();

    setImmediate(async () => {
      try {
        await kafkaProducer.publishProductUpdated(
          product.toJSON(),
          correlationId || `product-update-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish product updated event:', error);
      }
    });

    return product;
  }

  async deleteProduct(productId, sellerId) {
    const result = await Product.deleteOne({ _id: productId, sellerId });

    if (result.deletedCount === 0) {
      const error = new Error('Product not found or unauthorized');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    return true;
  }

  async reserveStock(productId, variantId, quantity, orderId, reservationTimeoutMs = 300000, correlationId) {
    const reservationId = uuidv4();
    const expiresAt = new Date(Date.now() + reservationTimeoutMs);

    // CHANGE: Simplified atomic operation using only stock field
    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
        'variants.stock': { $gte: quantity },
      },
      {
        $inc: { 'variants.$[variant].stock': -quantity },
        $push: {
          'variants.$[variant].reservations': {
            reservationId,
            orderId,
            quantity,
            expiresAt,
            status: 'active',
          }
        }
      },
      {
        arrayFilters: [{ 'variant._id': variantId }],
      }
    );

    if (updateResult.modifiedCount === 0) {
      const error = new Error('Insufficient stock for reservation');
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }

    console.log(`✅ Stock reserved: ${quantity} units for order ${orderId} (reservation: ${reservationId})`);

    return {
      reservationId,
      productId,
      variantId,
      quantity,
      expiresAt,
      orderId,
    };
  }

  async confirmReservation(productId, variantId, reservationId, orderId, correlationId) {
    const product = await Product.findById(productId);
    if (!product) {
      const error = new Error('Product not found');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const variant = product.variants.find(v => v._id === variantId);
    if (!variant) {
      const error = new Error('Variant not found');
      error.code = 'VARIANT_NOT_FOUND';
      throw error;
    }

    const reservation = variant.reservations.find(r => r.reservationId === reservationId);
    if (!reservation || reservation.status !== 'active') {
      const error = new Error('Reservation not found or already processed');
      error.code = 'RESERVATION_NOT_FOUND';
      throw error;
    }

    // CHANGE: Mark reservation as confirmed without additional stock changes
    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
        'variants.reservations.reservationId': reservationId,
        'variants.reservations.status': 'active',
      },
      {
        $set: {
          'variants.$[variant].reservations.$[reservation].status': 'confirmed',
        }
      },
      {
        arrayFilters: [
          { 'variant._id': variantId },
          { 'reservation.reservationId': reservationId }
        ],
      }
    );

    if (updateResult.modifiedCount === 0) {
      const error = new Error('Failed to confirm reservation');
      error.code = 'RESERVATION_CONFIRMATION_FAILED';
      throw error;
    }

    setImmediate(async () => {
      try {
        await kafkaProducer.publishStockDeducted(
          productId,
          variantId,
          reservation.quantity,
          orderId,
          correlationId || `stock-confirm-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish stock deducted event:', error);
      }
    });

    console.log(`✅ Reservation confirmed: ${reservationId} - ${reservation.quantity} units deducted`);
    return true;
  }

  async releaseReservation(productId, variantId, reservationId, correlationId) {
    const product = await Product.findById(productId);
    if (!product) {
      console.warn(`⚠️ Product ${productId} not found for reservation release`);
      return false;
    }

    const variant = product.variants.find(v => v._id === variantId);
    if (!variant) {
      console.warn(`⚠️ Variant ${variantId} not found for reservation release`);
      return false;
    }

    const reservation = variant.reservations.find(r => r.reservationId === reservationId);
    if (!reservation || reservation.status !== 'active') {
      console.warn(`⚠️ Reservation ${reservationId} not found or already processed`);
      return false;
    }

    // CHANGE: Restore stock and mark reservation as released
    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
        'variants.reservations.reservationId': reservationId,
        'variants.reservations.status': 'active',
      },
      {
        $inc: { 'variants.$[variant].stock': reservation.quantity },
        $set: {
          'variants.$[variant].reservations.$[reservation].status': 'released',
        }
      },
      {
        arrayFilters: [
          { 'variant._id': variantId },
          { 'reservation.reservationId': reservationId }
        ],
      }
    );

    if (updateResult.modifiedCount === 0) {
      console.warn(`⚠️ Reservation ${reservationId} not found or already processed`);
      return false;
    }

    console.log(`🔓 Reservation released: ${reservationId}`);
    return true;
  }

  async deductStock(productId, variantId, quantity, orderId, correlationId) {
    const product = await Product.findById(productId);
    if (!product) {
      const error = new Error('Product not found');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const variant = product.variants.find(v => v._id === variantId);
    if (!variant) {
      const error = new Error('Variant not found');
      error.code = 'VARIANT_NOT_FOUND';
      throw error;
    }

    if (variant.stock < quantity) {
      const error = new Error(`Insufficient stock. Available: ${variant.stock}, Requested: ${quantity}`);
      error.code = 'INSUFFICIENT_STOCK';
      error.available = variant.stock;
      error.requested = quantity;
      throw error;
    }

    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
        'variants.stock': { $gte: quantity },
      },
      {
        $inc: { 'variants.$[elem].stock': -quantity },
      },
      {
        arrayFilters: [{ 'elem._id': variantId }],
      }
    );

    if (updateResult.modifiedCount === 0) {
      const error = new Error('Stock deduction failed. Stock may have changed during transaction');
      error.code = 'STOCK_DEDUCTION_FAILED';
      throw error;
    }

    setImmediate(async () => {
      try {
        await kafkaProducer.publishStockDeducted(
          productId,
          variantId,
          quantity,
          orderId,
          correlationId || `stock-deduct-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish stock deducted event:', error);
      }
    });

    return true;
  }

  async restoreStock(productId, variantId, quantity, orderId, correlationId) {
    const product = await Product.findById(productId);
    if (!product) {
      const error = new Error('Product not found');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const variantIndex = product.variants.findIndex(v => v._id === variantId);
    if (variantIndex === -1) {
      const error = new Error(`Variant ${variantId} not found in product ${productId}`);
      error.code = 'VARIANT_NOT_FOUND';
      throw error;
    }

    console.log(`🔄 Restoring stock for product ${productId}, variant ${variantId}:`, {
      variantName: product.variants[variantIndex].name,
      currentStock: product.variants[variantIndex].stock,
      quantityToRestore: quantity,
      orderId,
    });

    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
      },
      {
        $inc: { 'variants.$[elem].stock': quantity },
      },
      {
        arrayFilters: [{ 'elem._id': variantId }],
      }
    );

    if (updateResult.modifiedCount === 0) {
      const error = new Error('Stock restoration failed');
      error.code = 'STOCK_RESTORATION_FAILED';
      throw error;
    }

    const updatedProduct = await Product.findById(productId);
    const updatedVariant = updatedProduct.variants.find(v => v._id === variantId);
    
    console.log(`✅ Stock restored successfully:`, {
      variantName: updatedVariant.name,
      newStock: updatedVariant.stock,
      orderId,
    });
    
    setImmediate(async () => {
      try {
        await kafkaProducer.publishStockRestored(
          productId,
          variantId,
          quantity,
          orderId,
          correlationId || `stock-restore-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish stock restored event:', error);
      }
    });

    return true;
  }

  async getProductStock(productId, variantId) {
    const product = await Product.findById(productId);
    if (!product) {
      const error = new Error('Product not found');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    if (variantId) {
      const variant = product.variants.find(v => v._id === variantId);
      if (!variant) {
        const error = new Error('Variant not found');
        error.code = 'VARIANT_NOT_FOUND';
        throw error;
      }
      
      // CHANGE: Return only stock field consistently
      return {
        productId,
        productName: product.name,
        variantId,
        variantName: variant.name,
        stock: variant.stock,
        sellerId: product.sellerId,
      };
    }

    // CHANGE: Return total stock across all variants
    const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
    return {
      productId,
      productName: product.name,
      stock: totalStock,
      sellerId: product.sellerId,
    };
  }
}

module.exports = new ProductService();