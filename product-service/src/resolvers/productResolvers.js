// backend/product-service/src/resolvers/productResolvers.js

const Product = require('../models/Product');
const { authenticate, requireSeller } = require('../middleware/auth');
const { sanitizeProductInput } = require('../utils/inputSanitizer');
const { formatDescriptionToBullets } = require('../utils/descriptionFormatter');

const resolvers = {
  Query: {
    products: async (_, { search, category, limit = 20, offset = 0 }) => {
      try {
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
      } catch (error) {
        throw new Error(error.message);
      }
    },

    product: async (_, { id }) => {
      try {
        const product = await Product.findById(id);
        if (!product) {
          throw new Error('Product not found');
        }
        return product;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    sellerProducts: async (_, __, context) => {
      try {
        const user = await requireSeller(context);
        const products = await Product.find({ sellerId: user.userId })
          .sort({ createdAt: -1 });
        return products;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    categories: async () => {
      try {
        const categories = await Product.distinct('category');
        return categories;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },

  Mutation: {
    createProduct: async (_, { input }, context) => {
      try {
        console.log('🔐 Authenticating seller...');
        const user = await requireSeller(context);
        console.log('✅ Authenticated user:', user.userId);

        console.log('📥 Raw input:', JSON.stringify(input, null, 2));

        // Sanitize the input to handle HTML entities and malformed JSON
        const sanitizedInput = sanitizeProductInput(input);
        
        console.log('🧹 Sanitized input:', JSON.stringify(sanitizedInput, null, 2));

        // Validate required fields after sanitization
        if (!sanitizedInput.name || !sanitizedInput.description || !sanitizedInput.category) {
          throw new Error('Missing required fields: name, description, and category are required');
        }

        if (typeof sanitizedInput.basePrice !== 'number' || sanitizedInput.basePrice < 0) {
          throw new Error('Base price must be a valid positive number');
        }

        // CHANGE: Validate that at least one variant is provided
        if (!sanitizedInput.variants || sanitizedInput.variants.length === 0) {
          throw new Error('At least one product variant is required. Please add variant details including stock quantity.');
        }

        // CHANGE: Validate each variant has required stock field
        sanitizedInput.variants.forEach((variant, index) => {
          if (typeof variant.stock !== 'number' || variant.stock < 0) {
            throw new Error(`Variant ${index + 1} (${variant.name || 'unnamed'}) must have a valid stock quantity (0 or greater)`);
          }
        });

        const product = new Product({
          ...sanitizedInput,
          sellerId: user.userId,
        });

        console.log('💾 Attempting to save product...');
        await product.save();
        console.log('✅ Product saved successfully:', product._id);
        
        return product;
      } catch (error) {
        console.error('❌ createProduct error:', {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack,
        });
        throw new Error(error.message);
      }
    },

    updateProduct: async (_, { id, input }, context) => {
      try {
        const user = await requireSeller(context);

        const product = await Product.findOne({ _id: id, sellerId: user.userId });
        if (!product) {
          throw new Error('Product not found or unauthorized');
        }

        // Sanitize the update input as well
        const sanitizedInput = sanitizeProductInput(input);

        // CHANGE: If variants are being updated, validate at least one exists
        if (sanitizedInput.variants !== undefined) {
          if (!sanitizedInput.variants || sanitizedInput.variants.length === 0) {
            throw new Error('At least one product variant is required. Cannot remove all variants.');
          }

          // CHANGE: Validate stock for each variant
          sanitizedInput.variants.forEach((variant, index) => {
            if (typeof variant.stock !== 'number' || variant.stock < 0) {
              throw new Error(`Variant ${index + 1} (${variant.name || 'unnamed'}) must have a valid stock quantity (0 or greater)`);
            }
          });
        }

        Object.assign(product, sanitizedInput);
        await product.save();

        return product;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    deleteProduct: async (_, { id }, context) => {
      try {
        const user = await requireSeller(context);

        const result = await Product.deleteOne({ _id: id, sellerId: user.userId });
        
        if (result.deletedCount === 0) {
          throw new Error('Product not found or unauthorized');
        }

        return true;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    deductStock: async (_, { productId, variantId, quantity }, context) => {
      try {
        console.log(`📦 Deducting stock: Product ${productId}, Variant ${variantId}, Quantity ${quantity}`);

        const product = await Product.findById(productId);
        if (!product) {
          throw new Error('Product not found');
        }

        const variant = product.variants.find(v => v._id === variantId);
        if (!variant) {
          throw new Error('Variant not found');
        }

        if (variant.stock < quantity) {
          throw new Error(
            `Insufficient stock for deduction. Available: ${variant.stock}, Requested: ${quantity}`
          );
        }

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
          throw new Error('Stock deduction failed. Stock may have changed during transaction.');
        }

        console.log(`✅ Stock deducted successfully: ${quantity} units from variant ${variantId}`);
        return true;
      } catch (error) {
        console.error('❌ Stock deduction error:', error.message);
        throw new Error(error.message);
      }
    },
  },

  Product: {
    variants: (product, args, context, info) => {
      context.product = product;
      return product.variants || [];
    },

    formattedDescription: (product) => {
      return formatDescriptionToBullets(product.description);
    },
  },

  Variant: {
    effectiveDescription: (variant, _, context, info) => {
      const product = info.variableValues.product || variant.parent();
      return variant.description || product.description;
    },
    
    effectiveImages: (variant, _, context, info) => {
      const product = info.variableValues.product || variant.parent();
      return variant.images && variant.images.length > 0 ? variant.images : product.images;
    },

    effectivePrice: (variant, args, context, info) => {
      const product = info.path.prev.key === 'variants' ? 
        context.product || info.rootValue : 
        variant.parent();
      
      if (!product || typeof product.basePrice !== 'number') {
        return variant.priceModifier || 0;
      }
      
      return product.basePrice + (variant.priceModifier || 0);
    },
  },
};

module.exports = resolvers;