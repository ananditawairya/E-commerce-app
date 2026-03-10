const { requireBuyer, requireSeller } = require('../../middleware/auth');
const client = require('./client');

/**
 * Checks whether upstream stock failure is due to missing variant.
 * @param {unknown} error Upstream error.
 * @return {boolean} True when variant no longer exists.
 */
function isVariantNotFoundError(error) {
  const message = client.getApiErrorMessage(error);
  return /variant not found/i.test(message);
}

/**
 * Builds mutation resolver map.
 * @return {object} Mutation resolver map.
 */
function buildMutationResolvers() {
  const authFromContext = (context) => context.req?.headers?.authorization;

  return {
    addToCart: async (_, { productId, productName, variantId, variantName, quantity, price }, context) => {
      try {
        const user = await requireBuyer(context);

        let finalProductName = productName;
        let finalVariantName = variantName;
        if (!productName || (variantId && !variantName)) {
          const product = await client.getProductDetails(productId, context.correlationId);
          finalProductName = productName || product.name;
          if (variantId && !variantName) {
            const variant = product.variants.find((item) => item.id === variantId);
            if (!variant) {
              throw new Error('Variant not found');
            }
            finalVariantName = variant.name;
          }
        }

        const stockInfo = await client.getProductStock(productId, variantId, context.correlationId);

        const authHeader = authFromContext(context);
        const cart = await client.getCart(user.userId, context.correlationId, authHeader);

        const existingItem = cart.items.find(
          (item) => item.productId === productId
            && (item.variantId || null) === (variantId || null)
        );
        const existingQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = existingQuantity + quantity;

        if (totalRequestedQuantity > stockInfo.stock) {
          throw new Error(
            `Cannot add ${quantity} units. You already have ${existingQuantity} in cart. `
            + `Product has ${stockInfo.stock} total stock. `
            + `You can add up to ${Math.max(0, stockInfo.stock - existingQuantity)} more units.`
          );
        }

        return await client.addToCart(
          user.userId,
          {
            productId,
            productName: finalProductName,
            variantId,
            variantName: finalVariantName,
            quantity,
            price,
          },
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    updateCartItem: async (_, { productId, variantId, quantity }, context) => {
      try {
        const user = await requireBuyer(context);
        const authHeader = authFromContext(context);
        const cart = await client.getCart(user.userId, context.correlationId, authHeader);

        const existingItem = cart?.items?.find(
          (item) => item.productId === productId
            && (item.variantId || null) === (variantId || null)
        );

        if (!existingItem) {
          throw new Error('Item not found in cart');
        }

        if (quantity > 0) {
          const isIncreasingQuantity = quantity > existingItem.quantity;
          if (isIncreasingQuantity) {
            let stockInfo;
            try {
              stockInfo = await client.getProductStock(productId, variantId, context.correlationId);
            } catch (stockError) {
              if (isVariantNotFoundError(stockError)) {
                throw new Error(`Insufficient stock. Available: 0, Requested: ${quantity}`);
              }
              throw stockError;
            }

            if (quantity > stockInfo.stock) {
              throw new Error(
                `Insufficient stock. Available: ${stockInfo.stock}, Requested: ${quantity}`
              );
            }
          }
        }

        return await client.updateCartItem(
          user.userId,
          { productId, variantId, quantity },
          context.correlationId,
          authHeader
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    removeFromCart: async (_, { productId, variantId }, context) => {
      try {
        const user = await requireBuyer(context);

        return await client.removeFromCart(
          user.userId,
          { productId, variantId },
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    clearCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);

        await client.clearCart(user.userId, context.correlationId, authFromContext(context));
        return true;
      } catch (error) {
        return false;
      }
    },

    checkout: async (_, { shippingAddress }, context) => {
      try {
        const user = await requireBuyer(context);

        const authHeader = authFromContext(context);
        const cart = await client.getCart(user.userId, context.correlationId, authHeader);

        if (!cart || cart.items.length === 0) {
          throw new Error('Cart is empty');
        }

        const stockValidationPromises = cart.items.map(async (item) => {
          let stockInfo;
          try {
            stockInfo = await client.getProductStock(item.productId, item.variantId, context.correlationId);
          } catch (stockError) {
            if (isVariantNotFoundError(stockError)) {
              throw new Error(
                `Insufficient stock for ${item.productName}${item.variantId ? ` (${item.variantName})` : ''}. `
                + `Available: 0, Requested: ${item.quantity}`
              );
            }
            throw stockError;
          }

          if (item.quantity > stockInfo.stock) {
            throw new Error(
              `Insufficient stock for ${stockInfo.productName}${item.variantId ? ` (${stockInfo.variantName})` : ''}. `
              + `Available: ${stockInfo.stock}, Requested: ${item.quantity}`
            );
          }

          return {
            stockInfo,
            cartItem: item,
          };
        });

        const validationResults = await Promise.all(stockValidationPromises);

        const orderItems = validationResults.map(({ stockInfo, cartItem }) => ({
          productId: cartItem.productId,
          productName: stockInfo.productName,
          variantId: cartItem.variantId,
          variantName: cartItem.variantId ? stockInfo.variantName : null,
          quantity: cartItem.quantity,
          price: cartItem.price,
          sellerId: stockInfo.sellerId,
        }));

        const totalAmount = orderItems.reduce(
          (total, item) => total + (item.price * item.quantity),
          0
        );

        const orders = await client.createOrders(
          user.userId,
          {
            items: orderItems,
            totalAmount,
            shippingAddress,
          },
          context.correlationId,
          authHeader
        );

        context.log.info({
          orderCount: orders.length,
          orderIds: orders.map((order) => order.orderId),
        }, 'Orders created, stock deduction will be processed via Kafka');

        await client.clearCart(user.userId, context.correlationId, authHeader);

        return orders[0];
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    updateOrderStatus: async (_, { orderId, status }, context) => {
      try {
        const user = await requireSeller(context);

        return await client.updateOrderStatus(
          orderId,
          user.userId,
          status,
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },

    cancelOrder: async (_, { orderId }, context) => {
      try {
        const user = await requireSeller(context);

        return await client.cancelOrder(
          orderId,
          user.userId,
          context.correlationId,
          authFromContext(context)
        );
      } catch (error) {
        throw new Error(client.getApiErrorMessage(error));
      }
    },
  };
}

module.exports = {
  buildMutationResolvers,
};
