/**
 * Resolves downstream service URLs from environment configuration.
 * @return {{
 *   auth: string,
 *   product: string,
 *   order: string,
 *   ai: string,
 * }} Service URL map.
 */
function getServiceUrls() {
  return {
    auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
    product: process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002',
    order: process.env.ORDER_SERVICE_URL || 'http://localhost:4003',
    ai: process.env.AI_SERVICE_URL || 'http://localhost:4004',
  };
}

module.exports = {
  getServiceUrls,
};
