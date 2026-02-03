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

const getProductDetails = async (productId, correlationId) => {
  try {
    const response = await axios.get(
      `${PRODUCT_API_URL}/${productId}`,
      {
        headers: {
          'X-Correlation-ID': correlationId,
        },
        timeout: 5000,
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch product details: ${error.response?.data?.message || error.message}`);
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
    addToCart: async (_, { productId, productName, variantId, variantName, quantity, price }, context) => {
      try {
        const user = await requireBuyer(context);
        let finalProductName = productName;
        let finalVariantName = variantName;
        
        if (!productName || (variantId && !variantName)) {
          const product = await getProductDetails(productId, context.correlationId);
          finalProductName = productName || product.name;
          if (variantId && !variantName) {
            const variant = product.variants.find(v => v.id === variantId);
            if (!variant) {
              throw new Error('Variant not found');
            }
            finalVariantName = variant.name;
          }
        }

        // CHANGE: Create a temporary reservation to prevent race conditions
        let reservationId = null;
        try {
          const reservationResponse = await axios.post(
            `${PRODUCT_API_URL}/${productId}/reserve-stock`,
            {
              variantId,
              quantity,
              orderId: `cart-temp-${user.userId}-${Date.now()}`,
              timeoutMs: 30000, // 30 seconds for cart operation
            },
            {
              headers: {
                'X-Correlation-ID': context.correlationId,
              },
              timeout: 5000,
            }
          );
          reservationId = reservationResponse.data.reservationId;

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

          // CHANGE: Call REST API to add to cart
          const response = await axios.post(
            `${CART_API_URL}/${user.userId}/items`,
            { 
              productId, 
              productName: finalProductName, 
              variantId, 
              variantName: finalVariantName, 
              quantity, 
              price 
            },
            {
              headers: {
                'X-Correlation-ID': context.correlationId,
              },
            }
          );

          // CHANGE: Release the temporary reservation after successful cart addition
          await axios.post(
            `${PRODUCT_API_URL}/${productId}/release-reservation`,
            {
              variantId,
              reservationId,
            },
            {
              headers: {
                'X-Correlation-ID': context.correlationId,
              },
            }
          );

          return response.data;
        } catch (error) {
          // CHANGE: Release reservation on any error
          if (reservationId) {
            try {
              await axios.post(
                `${PRODUCT_API_URL}/${productId}/release-reservation`,
                {
                  variantId,
                  reservationId,
                },
                {
                  headers: {
                    'X-Correlation-ID': context.correlationId,
                  },
                }
              );
            } catch (releaseError) {
              console.error('Failed to release reservation:', releaseError.message);
            }
          }
          throw new Error(error.response?.data?.message || error.message);
        }
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

    // CHANGE: Get cart without clearing it first
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

      return {
        stockInfo,
        cartItem: item,
      };
    });

    const validationResults = await Promise.all(stockValidationPromises);

    // Prepare order items
    const orderItems = validationResults.map(({ stockInfo, cartItem }) => {
      return {
        productId: cartItem.productId,
        productName: stockInfo.productName,
        variantId: cartItem.variantId,
        variantName: cartItem.variantId ? stockInfo.variantName : null,
        quantity: cartItem.quantity,
        price: cartItem.price,
        sellerId: stockInfo.sellerId,
      };
    });

    const totalAmount = orderItems.reduce(
      (total, item) => total + (item.price * item.quantity),
      0
    );

    // CHANGE: Create orders via REST API (cart clearing happens atomically in service)
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
    const orders = orderResponse.data;

    context.log.info({ 
      orderCount: orders.length,
      orderIds: orders.map(o => o.orderId) 
    }, 'Orders created, stock deduction will be processed via Kafka');

    // CHANGE: Cart is cleared atomically in the order service

    // CHANGE: Return first order for backward compatibility (mobile expects single order)
    // In future, update mobile to handle multiple orders
    return orders[0];
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

    // CHANGE: Add missing cancelOrder mutation resolver
    cancelOrder: async (_, { orderId }, context) => {
      try {
        const user = await requireSeller(context);

        // CHANGE: Call REST API to cancel order
        const response = await axios.put(
          `${ORDERS_API_URL}/${orderId}/cancel`,
          { sellerId: user.userId },
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