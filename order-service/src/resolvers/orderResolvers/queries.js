const { authenticate, requireBuyer, requireSeller } = require('../../middleware/auth');
const client = require('./client');

/**
 * Checks whether stock fetch failure indicates stale/missing variant.
 * @param {unknown} error Rejection reason.
 * @return {boolean} True when variant no longer exists.
 */
function isVariantNotFoundError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return /variant not found/i.test(message);
}

/**
 * Builds query resolver map.
 * @return {object} Query resolver map.
 */
function buildQueryResolvers() {
  const authFromContext = (context) => context.req?.headers?.authorization;

  return {
    myCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await client.getCart(
          user.userId,
          context.correlationId,
          authFromContext(context)
        );

        if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
          return cart;
        }

        const stockChecks = await Promise.allSettled(
          cart.items.map((item) => (
            client.getProductStock(item.productId, item.variantId, context.correlationId)
          ))
        );

        const items = cart.items.map((item, index) => {
          const stockResult = stockChecks[index];
          if (stockResult?.status !== 'fulfilled') {
            return {
              ...item,
              // Stale variant ids should behave as out-of-stock in cart UI.
              availableStock: isVariantNotFoundError(stockResult?.reason) ? 0 : null,
            };
          }

          const rawStock = Number.parseInt(stockResult.value?.stock, 10);
          return {
            ...item,
            availableStock: Number.isFinite(rawStock)
              ? Math.max(0, rawStock)
              : null,
          };
        });

        return {
          ...cart,
          items,
        };
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    myOrders: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        return await client.getBuyerOrders(
          user.userId,
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    sellerOrders: async (_, __, context) => {
      try {
        const user = await requireSeller(context);
        return await client.getSellerOrders(
          user.userId,
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    sellerAnalytics: async (_, { days }, context) => {
      try {
        const user = await requireSeller(context);
        return await client.getSellerAnalytics(
          user.userId,
          days,
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    order: async (_, { id }, context) => {
      try {
        const user = await authenticate(context);
        const order = await client.getOrderById(id, context.correlationId, authFromContext(context));

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
