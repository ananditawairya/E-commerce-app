/**
 * Creates product mutation resolvers.
 * @param {{
 *   axios: object,
 *   requireSeller: Function,
 *   API_BASE_URL: string,
 *   INTERNAL_API_BASE_URL: string,
 *   getErrorMessage: (error: unknown) => string,
 * }} deps Dependencies.
 * @return {object} Mutation resolvers.
 */
function createMutationResolvers({
  axios,
  requireSeller,
  API_BASE_URL,
  INTERNAL_API_BASE_URL,
  getErrorMessage,
}) {
  const createRequestHeaders = (context, { includeAuth = false, includeInternal = false } = {}) => {
    const headers = {
      'X-Correlation-ID': context.correlationId,
    };

    if (includeAuth && context.req?.headers?.authorization) {
      headers.Authorization = context.req.headers.authorization;
    }

    if (includeInternal && context.req?.headers?.['x-internal-gateway-token']) {
      headers['x-internal-gateway-token'] = context.req.headers['x-internal-gateway-token'];
    }

    return headers;
  };

  return {
    async createProduct(_, { input }, context) {
      try {
        const user = await requireSeller(context);
        const response = await axios.post(
          API_BASE_URL,
          { sellerId: user.userId, input },
          {
            headers: createRequestHeaders(context, { includeAuth: true }),
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async updateProduct(_, { id, input }, context) {
      try {
        const user = await requireSeller(context);
        const response = await axios.put(
          `${API_BASE_URL}/${id}`,
          { sellerId: user.userId, input },
          {
            headers: createRequestHeaders(context, { includeAuth: true }),
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async deleteProduct(_, { id }, context) {
      try {
        const user = await requireSeller(context);
        await axios.delete(`${API_BASE_URL}/${id}`, {
          data: { sellerId: user.userId },
          headers: createRequestHeaders(context, { includeAuth: true }),
        });
        return true;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },

    async deductStock(_, { productId, variantId, quantity }, context) {
      try {
        await axios.post(
          `${INTERNAL_API_BASE_URL}/${productId}/deduct-stock`,
          { variantId, quantity },
          {
            headers: createRequestHeaders(context, { includeInternal: true }),
          }
        );
        return true;
      } catch (error) {
        throw new Error(getErrorMessage(error));
      }
    },
  };
}

module.exports = {
  createMutationResolvers,
};
