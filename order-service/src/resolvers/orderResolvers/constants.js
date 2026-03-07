/**
 * Resolver-layer API endpoint constants.
 */

const ORDER_SERVICE_BASE = process.env.ORDER_API_URL || 'http://localhost:4003/api';
const CART_API_URL = `${ORDER_SERVICE_BASE}/cart`;
const ORDERS_API_URL = `${ORDER_SERVICE_BASE}/orders`;
const PRODUCT_API_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';
const INTERNAL_PRODUCT_API_URL = process.env.INTERNAL_PRODUCT_API_URL || 'http://localhost:4002/internal/products';

module.exports = {
  CART_API_URL,
  ORDERS_API_URL,
  PRODUCT_API_URL,
  INTERNAL_PRODUCT_API_URL,
};
