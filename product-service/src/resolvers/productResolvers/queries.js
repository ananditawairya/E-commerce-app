/**
 * Creates product query resolvers.
 * @param {{
 *   axios: object,
 *   requireSeller: Function,
 *   API_BASE_URL: string,
 *   getErrorMessage: (error: unknown) => string,
 * }} deps Dependencies.
 * @return {object} Query resolvers.
 */
function createQueryResolvers({
  axios,
  requireSeller,
  API_BASE_URL,
  getErrorMessage,
}) {
  return {
    async products(
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
    ) {
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
        throw new Error(getErrorMessage(error));
      }
    },

    async product(_, { id }, context) {
      try {
        const response = await axios.get(`${API_BASE_URL}/${id}`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async sellerProducts(_, __, context) {
      try {
        const user = await requireSeller(context);
        const response = await axios.get(`${API_BASE_URL}/seller/${user.userId}`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async categories(_, __, context) {
      try {
        const response = await axios.get(`${API_BASE_URL}/categories`, {
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async searchSuggestions(_, { query, categories, limit }, context) {
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
        throw new Error(getErrorMessage(error));
      }
    },
  };
}

module.exports = {
  createQueryResolvers,
};
