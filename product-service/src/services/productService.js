// backend/product-service/src/services/productService.js
// CHANGE: New service layer for product database operations

const Product = require('../models/Product');
const { sanitizeProductInput } = require('../utils/inputSanitizer');

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

  async createProduct(sellerId, input) {
    // Sanitize input
    const sanitizedInput = sanitizeProductInput(input);

    // Validate required fields
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

    // Validate variants
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
    return product;
  }

  async updateProduct(productId, sellerId, input) {
    const product = await Product.findOne({ _id: productId, sellerId });
    if (!product) {
      const error = new Error('Product not found or unauthorized');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const sanitizedInput = sanitizeProductInput(input);

    // Validate variants if being updated
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

  async deductStock(productId, variantId, quantity) {
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

    // CHANGE: Atomic stock deduction
    const updateResult = await Product.updateOne(
      {
        _id: productId,
        'variants._id': variantId,
        'variants.stock': { $gte: quantity },
      },
      {
        $inc: { 'variants.$.stock': -quantity },
      }
    );

    if (updateResult.modifiedCount === 0) {
      const error = new Error('Stock deduction failed. Stock may have changed during transaction');
      error.code = 'STOCK_DEDUCTION_FAILED';
      throw error;
    }

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
      return {
        productId,
        productName: product.name,
        variantId,
        variantName: variant.name,
        stock: variant.stock,
        sellerId: product.sellerId,
      };
    }

    // Return total stock across all variants
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