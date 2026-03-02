const { authenticate, requireBuyer, requireSeller } = require('../../middleware/auth');
const client = require('./client');

/**
 * Builds query resolver map.
 * @return {object} Query resolver map.
 */
function buildQueryResolvers() {
  return {
    myCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        return await client.getCart(user.userId, context.correlationId);
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    myOrders: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        return await client.getBuyerOrders(user.userId, context.correlationId);
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    sellerOrders: async (_, __, context) => {
      try {
        const user = await requireSeller(context);
        return await client.getSellerOrders(user.userId, context.correlationId);
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    sellerAnalytics: async (_, { days }, context) => {
      try {
        const user = await requireSeller(context);
        return await client.getSellerAnalytics(user.userId, days, context.correlationId);
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    order: async (_, { id }, context) => {
      try {
        const user = await authenticate(context);
        const order = await client.getOrderById(id, context.correlationId);

        const isBuyer = user.role === 'buyer' && order.buyerId === user.userId;
        const isSeller = user.role === 'seller'
          && order.items.some((item) => item.sellerId === user.userId);

        if (!isBuyer && !isSeller) {
          throw new Error('Unauthorized');
        }

        return order;
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },
  };
}

module.exports = {
  buildQueryResolvers,
};
