// backend/product-service/src/resolvers/productResolvers.js
// CHANGE: Modified to call REST API instead of direct database access

const axios = require('axios');
const { requireSeller } = require('../middleware/auth');
const { formatDescriptionToBullets } = require('../utils/descriptionFormatter');

const API_BASE_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';

const resolvers = {
  Query: {
    products: async (_, { search, category, limit = 20, offset = 0 }, context) => {
      try {
        const response = await axios.get(API_BASE_URL, {
          params: { search, category, limit, offset },
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    product: async (_, { id }, context) => {
      try {
        const response = await axios.get(`${API_BASE_URL}/${id}`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    sellerProducts: async (_, __, context) => {
      try {
        // CHANGE: Add detailed logging to debug authentication flow
        console.log('🔍 sellerProducts resolver called');
        console.log('📋 Context headers:', {
          authorization: context.req?.headers?.authorization ? 'present' : 'missing',
          internalToken: context.req?.headers['x-internal-gateway-token'] ? 'present' : 'missing',
        });

        const user = await requireSeller(context);
        
        // CHANGE: Validate user object before proceeding
        if (!user || !user.userId) {
          console.error('❌ Authentication returned invalid user object:', user);
          throw new Error('Authentication failed: Invalid user data');
        }

        console.log('✅ Authenticated seller:', {
          userId: user.userId,
          role: user.role,
          email: user.email,
        });

        const response = await axios.get(`${API_BASE_URL}/seller/${user.userId}`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        
        console.log(`📦 Fetched ${response.data.length} products for seller ${user.userId}`);
        return response.data;
      } catch (error) {
        // CHANGE: Enhanced error logging
        console.error('❌ sellerProducts resolver error:', {
          message: error.message,
          response: error.response?.data,
          stack: error.stack,
        });
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    categories: async (_, __, context) => {
      try {
        const response = await axios.get(`${API_BASE_URL}/categories`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },
  },

  Mutation: {
    createProduct: async (_, { input }, context) => {
      try {
        // CHANGE: Add detailed logging for authentication
        console.log('🔍 createProduct mutation called');
        
        const user = await requireSeller(context);
        
        // CHANGE: Validate user object
        if (!user || !user.userId) {
          console.error('❌ Authentication returned invalid user object:', user);
          throw new Error('Authentication failed: Invalid user data');
        }

        console.log('✅ Authenticated seller for product creation:', user.userId);

        const response = await axios.post(
          API_BASE_URL,
          { sellerId: user.userId, input },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        console.error('❌ createProduct error:', error.message);
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    updateProduct: async (_, { id, input }, context) => {
      try {
        const user = await requireSeller(context);

        // CHANGE: Validate user object
        if (!user || !user.userId) {
          console.error('❌ Authentication returned invalid user object:', user);
          throw new Error('Authentication failed: Invalid user data');
        }

        const response = await axios.put(
          `${API_BASE_URL}/${id}`,
          { sellerId: user.userId, input },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    deleteProduct: async (_, { id }, context) => {
      try {
        const user = await requireSeller(context);

        // CHANGE: Validate user object
        if (!user || !user.userId) {
          console.error('❌ Authentication returned invalid user object:', user);
          throw new Error('Authentication failed: Invalid user data');
        }

        await axios.delete(`${API_BASE_URL}/${id}`, {
          data: { sellerId: user.userId },
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return true;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    deductStock: async (_, { productId, variantId, quantity }, context) => {
      try {
        await axios.post(
          `${API_BASE_URL}/${productId}/deduct-stock`,
          { variantId, quantity },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return true;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },
  },

  Product: {
    variants: (product) => {
      return product.variants || [];
    },

    formattedDescription: (product) => {
      return formatDescriptionToBullets(product.description);
    },
  },

  Variant: {
    effectiveDescription: (variant, _, __, info) => {
      const product = info.path.prev && info.path.prev.key === 'variants' 
        ? info.path.prev.prev.result 
        : null;
      
      return variant.description || (product ? product.description : '');
    },

    effectiveImages: (variant, _, __, info) => {
      const product = info.path.prev && info.path.prev.key === 'variants' 
        ? info.path.prev.prev.result 
        : null;
      
      return variant.images && variant.images.length > 0 
        ? variant.images 
        : (product ? product.images : []);
    },

    effectivePrice: (variant, _, __, info) => {
      const product = info.path.prev && info.path.prev.key === 'variants' 
        ? info.path.prev.prev.result 
        : null;

      if (!product || typeof product.basePrice !== 'number') {
        return variant.priceModifier || 0;
      }

      return product.basePrice + (variant.priceModifier || 0);
    },
  },
};

module.exports = resolvers;