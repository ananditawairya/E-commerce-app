const axios = require('axios');
const {
  CART_API_URL,
  ORDERS_API_URL,
  PRODUCT_API_URL,
} = require('./constants');

/**
 * Returns best-effort API error message.
 * @param {Error} error Request error.
 * @return {string} Message text.
 */
function getApiErrorMessage(error) {
  return error.response?.data?.message || error.message;
}

/**
 * Creates base request headers with correlation id.
 * @param {string} correlationId Correlation id.
 * @return {object} Request headers.
 */
function createHeaders(correlationId) {
  return {
    'X-Correlation-ID': correlationId,
  };
}

/**
 * Fetches product stock from product-service API.
 * @param {string} productId Product id.
 * @param {string|null|undefined} variantId Variant id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Stock payload.
 */
async function getProductStock(productId, variantId, correlationId) {
  try {
    const response = await axios.get(
      `${PRODUCT_API_URL}/${productId}/stock`,
      {
        params: { variantId },
        headers: createHeaders(correlationId),
        timeout: 5000,
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch product stock: ${getApiErrorMessage(error)}`);
  }
}

/**
 * Fetches product details from product-service API.
 * @param {string} productId Product id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Product payload.
 */
async function getProductDetails(productId, correlationId) {
  try {
    const response = await axios.get(
      `${PRODUCT_API_URL}/${productId}`,
      {
        headers: createHeaders(correlationId),
        timeout: 5000,
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch product details: ${getApiErrorMessage(error)}`);
  }
}

/**
 * Fetches buyer cart.
 * @param {string} userId Buyer user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cart payload.
 */
async function getCart(userId, correlationId) {
  const response = await axios.get(
    `${CART_API_URL}/${userId}`,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Adds one item to buyer cart.
 * @param {string} userId Buyer user id.
 * @param {object} payload Item payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cart payload.
 */
async function addToCart(userId, payload, correlationId) {
  const response = await axios.post(
    `${CART_API_URL}/${userId}/items`,
    payload,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Updates one cart item.
 * @param {string} userId Buyer user id.
 * @param {object} payload Update payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cart payload.
 */
async function updateCartItem(userId, payload, correlationId) {
  const response = await axios.put(
    `${CART_API_URL}/${userId}/items`,
    payload,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Removes one cart item.
 * @param {string} userId Buyer user id.
 * @param {object} payload Remove payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cart payload.
 */
async function removeFromCart(userId, payload, correlationId) {
  const response = await axios.delete(
    `${CART_API_URL}/${userId}/items`,
    {
      data: payload,
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Clears cart for one buyer.
 * @param {string} userId Buyer user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<void>} No return value.
 */
async function clearCart(userId, correlationId) {
  await axios.delete(
    `${CART_API_URL}/${userId}`,
    {
      headers: createHeaders(correlationId),
    }
  );
}

/**
 * Fetches buyer orders.
 * @param {string} userId Buyer user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object[]>} Orders payload.
 */
async function getBuyerOrders(userId, correlationId) {
  const response = await axios.get(
    `${ORDERS_API_URL}/buyer/${userId}`,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Fetches seller orders.
 * @param {string} userId Seller user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object[]>} Orders payload.
 */
async function getSellerOrders(userId, correlationId) {
  const response = await axios.get(
    `${ORDERS_API_URL}/seller/${userId}`,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Fetches seller analytics.
 * @param {string} userId Seller user id.
 * @param {number} days Day range.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Analytics payload.
 */
async function getSellerAnalytics(userId, days, correlationId) {
  const response = await axios.get(
    `${ORDERS_API_URL}/seller/${userId}/analytics`,
    {
      params: { days },
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Fetches one order by id.
 * @param {string} orderId Order id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Order payload.
 */
async function getOrderById(orderId, correlationId) {
  const response = await axios.get(
    `${ORDERS_API_URL}/${orderId}`,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Creates order batch for buyer.
 * @param {string} userId Buyer user id.
 * @param {object} payload Order payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object[]>} Created orders.
 */
async function createOrders(userId, payload, correlationId) {
  const response = await axios.post(
    `${ORDERS_API_URL}/${userId}`,
    payload,
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Updates seller-owned order status.
 * @param {string} orderId Order id.
 * @param {string} sellerId Seller user id.
 * @param {string} status Next status.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Updated order.
 */
async function updateOrderStatus(orderId, sellerId, status, correlationId) {
  const response = await axios.put(
    `${ORDERS_API_URL}/${orderId}/status`,
    { sellerId, status },
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

/**
 * Cancels seller-owned order.
 * @param {string} orderId Order id.
 * @param {string} sellerId Seller user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cancelled order.
 */
async function cancelOrder(orderId, sellerId, correlationId) {
  const response = await axios.put(
    `${ORDERS_API_URL}/${orderId}/cancel`,
    { sellerId },
    {
      headers: createHeaders(correlationId),
    }
  );
  return response.data;
}

module.exports = {
  addToCart,
  cancelOrder,
  clearCart,
  createOrders,
  getApiErrorMessage,
  getBuyerOrders,
  getCart,
  getOrderById,
  getProductDetails,
  getProductStock,
  getSellerAnalytics,
  getSellerOrders,
  removeFromCart,
  updateCartItem,
  updateOrderStatus,
};
