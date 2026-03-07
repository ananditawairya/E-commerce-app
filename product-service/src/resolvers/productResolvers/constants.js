const API_BASE_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';
const INTERNAL_API_BASE_URL = process.env.INTERNAL_PRODUCT_API_URL || 'http://localhost:4002/internal/products';

module.exports = {
  API_BASE_URL,
  INTERNAL_API_BASE_URL,
};
