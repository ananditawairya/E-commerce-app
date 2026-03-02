/**
 * Registers gateway health endpoint.
 * @param {{
 *   app: import('express').Express,
 *   runtimeStore: {getMode: () => string},
 *   circuitBreakers: {auth: object, product: object, order: object},
 * }} deps Dependencies.
 * @return {void}
 */
function registerHealthRoute({ app, runtimeStore, circuitBreakers }) {
  app.get('/health', (req, res) => {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        runtimeStore: {
          mode: runtimeStore.getMode(),
        },
        auth: {
          status: circuitBreakers.auth.opened ? 'circuit_open' : 'healthy',
          stats: circuitBreakers.auth.stats,
        },
        product: {
          status: circuitBreakers.product.opened ? 'circuit_open' : 'healthy',
          stats: circuitBreakers.product.stats,
        },
        order: {
          status: circuitBreakers.order.opened ? 'circuit_open' : 'healthy',
          stats: circuitBreakers.order.stats,
        },
      },
    };
    res.json(healthStatus);
  });
}

module.exports = {
  registerHealthRoute,
};
