// backend/order-service/src/resolvers/orderResolvers.js
// CHANGE: Removed all legacy GraphQL inter-service calls, uses REST APIs exclusively

const { requireBuyer, requireSeller, authenticate } = require('../middleware/auth');
const axios = require('axios');

// CHANGE: Define resource-specific URLs from generic base for clarity
const ORDER_SERVICE_BASE = process.env.ORDER_API_URL || 'http://localhost:4003/api';
const CART_API_URL = `${ORDER_SERVICE_BASE}/cart`;
const ORDERS_API_URL = `${ORDER_SERVICE_BASE}/orders`;
const PRODUCT_API_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';

// CHANGE: Call REST API to get product stock (no legacy GraphQL query)
const getProductStock = async (productId, variantId, correlationId) => {
  try {
    const response = await axios.get(
      `${PRODUCT_API_URL}/${productId}/stock`,
      {
        params: { variantId },
        headers: {
          'X-Correlation-ID': correlationId,
        },
        // CHANGE: Add timeout for resilience
        timeout: 5000,
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch product stock: ${error.response?.data?.message || error.message}`);
  }
};

// CHANGE: Call REST API to deduct stock (no legacy GraphQL mutation)
const deductStock = async (productId, variantId, quantity, orderId, correlationId) => {
  try {
    await axios.post(
      `${PRODUCT_API_URL}/${productId}/deduct-stock`,
      { variantId, quantity, orderId },
      {
        headers: {
          'X-Correlation-ID': correlationId,
        },
        // CHANGE: Add timeout for resilience
        timeout: 10000,
      }
    );
    return true;
  } catch (error) {
    throw new Error(`Failed to deduct stock: ${error.response?.data?.message || error.message}`);
  }
};

const resolvers = {
  Cart: {
    totalAmount: (cart) => {
      return cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    },
  },

  Query: {
    myCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Use CART_API_URL constant for clarity
        const response = await axios.get(
          `${CART_API_URL}/${user.userId}`,
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

    myOrders: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Use ORDERS_API_URL constant for clarity
        const response = await axios.get(
          `${ORDERS_API_URL}/buyer/${user.userId}`,
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

    sellerOrders: async (_, __, context) => {
      try {
        const user = await requireSeller(context);

        // CHANGE: Use ORDERS_API_URL constant for clarity
        const response = await axios.get(
          `${ORDERS_API_URL}/seller/${user.userId}`,
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

    order: async (_, { id }, context) => {
      try {
        const user = await authenticate(context);

        // CHANGE: Use ORDERS_API_URL constant for clarity
        const response = await axios.get(
          `${ORDERS_API_URL}/${id}`,
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );

        const order = response.data;

        // Check authorization
        const isBuyer = user.role === 'buyer' && order.buyerId === user.userId;
        const isSeller = user.role === 'seller' &&
          order.items.some(item => item.sellerId === user.userId);

        if (!isBuyer && !isSeller) {
          throw new Error('Unauthorized');
        }

        return order;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },
  },

  Mutation: {
    addToCart: async (_, { productId, variantId, quantity, price }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Validate stock availability via REST API
        const stockInfo = await getProductStock(productId, variantId, context.correlationId);

        // CHANGE: Get current cart to check existing quantity
        const cartResponse = await axios.get(
          `${CART_API_URL}/${user.userId}`,
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        const cart = cartResponse.data;

        const existingItem = cart.items.find(
          item => item.productId === productId &&
            (item.variantId || null) === (variantId || null)
        );
        const existingQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = existingQuantity + quantity;

        if (totalRequestedQuantity > stockInfo.stock) {
          // CHANGE: Improved error message with clearer guidance
          throw new Error(
            `Cannot add ${quantity} units. You already have ${existingQuantity} in cart. ` +
            `Product has ${stockInfo.stock} total stock. ` +
            `You can add up to ${Math.max(0, stockInfo.stock - existingQuantity)} more units.`
          );
        }

        // CHANGE: Call REST API to add to cart
        const response = await axios.post(
          `${CART_API_URL}/${user.userId}/items`,
          { productId, variantId, quantity, price },
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

    updateCartItem: async (_, { productId, variantId, quantity }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Validate stock availability when updating quantity
        if (quantity > 0) {
          const stockInfo = await getProductStock(productId, variantId, context.correlationId);

          if (quantity > stockInfo.stock) {
            throw new Error(
              `Insufficient stock. Available: ${stockInfo.stock}, ` +
              `Requested: ${quantity}`
            );
          }
        }

        // CHANGE: Call REST API to update cart item
        const response = await axios.put(
          `${CART_API_URL}/${user.userId}/items`,
          { productId, variantId, quantity },
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

    removeFromCart: async (_, { productId, variantId }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Call REST API to remove from cart
        const response = await axios.delete(
          `${CART_API_URL}/${user.userId}/items`,
          {
            data: { productId, variantId },
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

    clearCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Call REST API to clear cart
        await axios.delete(
          `${CART_API_URL}/${user.userId}`,
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return true;
      } catch (error) {
        return false;
      }
    },

    checkout: async (_, { shippingAddress }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Get cart via REST API
        const cartResponse = await axios.get(
          `${CART_API_URL}/${user.userId}`,
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        const cart = cartResponse.data;

        if (!cart || cart.items.length === 0) {
          throw new Error('Cart is empty');
        }

        // CHANGE: Validate stock availability for all items via REST API
        const stockValidationPromises = cart.items.map(async (item) => {
          const stockInfo = await getProductStock(item.productId, item.variantId, context.correlationId);

          if (item.quantity > stockInfo.stock) {
            throw new Error(
              `Insufficient stock for ${stockInfo.productName}${item.variantId ? ` (${stockInfo.variantName})` : ''}. ` +
              `Available: ${stockInfo.stock}, Requested: ${item.quantity}`
            );
          }

          return stockInfo;
        });

        const productDetailsArray = await Promise.all(stockValidationPromises);

        // Prepare order items
        const orderItems = cart.items.map((item, index) => {
          const stockInfo = productDetailsArray[index];
          return {
            productId: item.productId,
            productName: stockInfo.productName,
            variantId: item.variantId,
            variantName: item.variantId ? stockInfo.variantName : null,
            quantity: item.quantity,
            price: item.price,
            sellerId: stockInfo.sellerId,
          };
        });

        const totalAmount = orderItems.reduce(
          (total, item) => total + (item.price * item.quantity),
          0
        );

        // CHANGE: Create order via REST API
        const orderResponse = await axios.post(
          `${ORDERS_API_URL}/${user.userId}`,
          {
            items: orderItems,
            totalAmount,
            shippingAddress,
          },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        const order = orderResponse.data;

        // CHANGE: Deduct stock via REST API
        context.log.info({ orderId: order.orderId }, 'Deducting stock for order items');
        const stockDeductionPromises = cart.items.map(async (item) => {
          if (!item.variantId) {
            throw new Error(`Variant ID is required for stock deduction`);
          }

          try {
            await deductStock(item.productId, item.variantId, item.quantity, order.orderId, context.correlationId);
            context.log.info({
              orderId: order.orderId,
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
            }, 'Stock deducted');
          } catch (error) {
            context.log.error({
              orderId: order.orderId,
              productId: item.productId,
              error: error.message,
            }, 'Failed to deduct stock');
            throw error;
          }
        });

        await Promise.all(stockDeductionPromises);
        context.log.info({ orderId: order.orderId }, 'All stock deductions completed');

        // CHANGE: Clear cart via REST API
        await axios.delete(
          `${CART_API_URL}/${user.userId}`,
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );

        return order;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    updateOrderStatus: async (_, { orderId, status }, context) => {
      try {
        const user = await requireSeller(context);

        // CHANGE: Call REST API to update order status
        const response = await axios.put(
          `${ORDERS_API_URL}/${orderId}/status`,
          { sellerId: user.userId, status },
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
  },
};

module.exports = resolvers;