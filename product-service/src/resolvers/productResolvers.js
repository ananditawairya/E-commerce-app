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
        const user = await requireSeller(context);
        
        const response = await axios.get(`${API_BASE_URL}/seller/${user.userId}`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
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
        const user = await requireSeller(context);

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
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    updateProduct: async (_, { id, input }, context) => {
      try {
        const user = await requireSeller(context);

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
    // CHANGE: Removed parent() calls - access parent product from GraphQL info context
    effectiveDescription: (variant, _, __, info) => {
      // CHANGE: Get parent product from the source object in GraphQL execution
      const product = info.path.prev && info.path.prev.key === 'variants' 
        ? info.path.prev.prev.result 
        : null;
      
      return variant.description || (product ? product.description : '');
    },

    effectiveImages: (variant, _, __, info) => {
      // CHANGE: Get parent product from the source object in GraphQL execution
      const product = info.path.prev && info.path.prev.key === 'variants' 
        ? info.path.prev.prev.result 
        : null;
      
      return variant.images && variant.images.length > 0 
        ? variant.images 
        : (product ? product.images : []);
    },

    effectivePrice: (variant, _, __, info) => {
      // CHANGE: Get parent product from the source object in GraphQL execution
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