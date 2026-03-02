// backend/product-service/src/resolvers/productResolvers.js

const axios = require('axios');
const { requireSeller } = require('../middleware/auth');
const { formatDescriptionToBullets } = require('../utils/descriptionFormatter');

const API_BASE_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';

/**
 * Normalizes id-like values into GraphQL ID strings.
 * @param {unknown} value Raw id value.
 * @return {string|null} Normalized ID or null when unavailable.
 */
function normalizeId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value && typeof value.toString === 'function') {
    const stringValue = value.toString();
    return typeof stringValue === 'string' && stringValue.trim()
      ? stringValue
      : null;
  }

  return null;
}

const resolvers = {
  Query: {
    products: async (
      _,
      {
        search,
        category,
        categories,
        minPrice,
        maxPrice,
        inStockOnly,
        sortBy,
        limit = 20,
        offset = 0,
      },
      context
    ) => {
      try {
        const normalizedCategories = Array.isArray(categories)
          ? categories
              .filter((value) => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean)
          : [];

        const params = {
          search,
          sortBy,
          limit,
          offset,
        };

        if (normalizedCategories.length > 0) {
          params.categories = normalizedCategories;
        } else if (typeof category === 'string' && category.trim()) {
          params.category = category.trim();
        }

        if (typeof minPrice === 'number') {
          params.minPrice = minPrice;
        }

        if (typeof maxPrice === 'number') {
          params.maxPrice = maxPrice;
        }

        if (typeof inStockOnly === 'boolean') {
          params.inStockOnly = inStockOnly;
        }

        const response = await axios.get(API_BASE_URL, {
          params,
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

    searchSuggestions: async (_, { query, categories, limit }, context) => {
      try {
        const response = await axios.get(`${API_BASE_URL}/search/suggestions`, {
          params: {
            query,
            categories,
            limit,
          },
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
    // Defensive: handle both _id and id for products from .lean() or raw queries
    id: (product) => normalizeId(product.id) || normalizeId(product._id),

    variants: (product) => {
      return product.variants || [];
    },

    formattedDescription: (product) => {
      return formatDescriptionToBullets(product.description);
    },
  },

  Variant: {
    id: (variant) => (
      normalizeId(variant.id)
      || normalizeId(variant._id)
      || normalizeId(variant.sku)
    ),

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
