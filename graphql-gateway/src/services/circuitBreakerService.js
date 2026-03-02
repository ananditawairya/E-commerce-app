/**
 * Builds a service request function for one base URL.
 * @param {string} baseUrl Base service URL.
 * @param {Function} fetch Network fetch implementation.
 * @return {(path: string, options?: object) => Promise<Response>} Request function.
 */
function buildServiceCaller(baseUrl, fetch) {
  return async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      timeout: 10000,
      ...options,
    });
    return response;
  };
}

/**
 * Creates all circuit breakers used by REST proxy routes.
 * @param {{
 *   serviceUrls: {auth: string, product: string, order: string},
 *   fetch: Function,
 *   CircuitBreaker: Function,
 * }} deps Dependencies.
 * @return {{
 *   auth: object,
 *   product: object,
 *   order: object,
 * }} Breaker map.
 */
function createCircuitBreakers({ serviceUrls, fetch, CircuitBreaker }) {
  const circuitBreakerOptions = {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
  };

  const auth = new CircuitBreaker(
    buildServiceCaller(serviceUrls.auth, fetch),
    circuitBreakerOptions
  );
  const product = new CircuitBreaker(
    buildServiceCaller(serviceUrls.product, fetch),
    circuitBreakerOptions
  );
  const order = new CircuitBreaker(
    buildServiceCaller(serviceUrls.order, fetch),
    circuitBreakerOptions
  );

  auth.fallback(() => ({ error: 'Auth service temporarily unavailable' }));
  product.fallback(() => ({ error: 'Product service temporarily unavailable' }));
  order.fallback(() => ({ error: 'Order service temporarily unavailable' }));

  return {
    auth,
    product,
    order,
  };
}

module.exports = {
  createCircuitBreakers,
};
