/**
 * Registers REST proxy routes for downstream services.
 * @param {{
 *   app: import('express').Express,
 *   getAuthLimiter: () => import('express').RequestHandler,
 *   authenticateToken: import('express').RequestHandler,
 *   circuitBreakers: {auth: object, product: object, order: object},
 * }} deps Dependencies.
 * @return {void}
 */
function registerRestProxyRoutes({
  app,
  getAuthLimiter,
  authenticateToken,
  circuitBreakers,
}) {
  app.use('/api/auth', (req, res, next) => getAuthLimiter()(req, res, next), async (req, res) => {
    try {
      const response = await circuitBreakers.auth.fire(`/api/users${req.path}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': req.correlationId,
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error('Auth service error:', error);
      res.status(503).json({ error: 'Auth service unavailable' });
    }
  });

  app.use('/api/products', async (req, res) => {
    try {
      const response = await circuitBreakers.product.fire(`/api/products${req.path}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': req.correlationId,
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error('Product service error:', error);
      res.status(503).json({ error: 'Product service unavailable' });
    }
  });

  app.use('/api/orders', authenticateToken, async (req, res) => {
    try {
      const response = await circuitBreakers.order.fire(`/api${req.path}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': req.correlationId,
          'X-User-ID': req.user.userId,
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error('Order service error:', error);
      res.status(503).json({ error: 'Order service unavailable' });
    }
  });
}

module.exports = {
  registerRestProxyRoutes,
};
