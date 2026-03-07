/**
 * Creates GraphQL middleware that enforces internal gateway token verification.
 * @param {{
 *   serviceName: string,
 *   verifyInternalToken: (token: string, secret: string) => unknown,
 *   internalJwtSecret: string|undefined,
 *   gatewayUrl?: string,
 * }} deps Dependencies.
 * @return {import('express').RequestHandler} Express middleware.
 */
function createGraphqlAuthMiddleware({
  serviceName,
  verifyInternalToken,
  internalJwtSecret,
  gatewayUrl = 'http://localhost:4000',
}) {
  if (typeof verifyInternalToken !== 'function') {
    throw new Error('verifyInternalToken function is required');
  }

  return (req, res, next) => {
    const internalToken = req.headers['x-internal-gateway-token'];
    if (!internalToken) {
      return res.status(403).json({
        error: `Direct GraphQL access forbidden. Use API Gateway at ${gatewayUrl}/graphql`,
      });
    }

    if (typeof internalJwtSecret !== 'string' || !internalJwtSecret.trim()) {
      console.error(
        `[${serviceName}] INTERNAL_JWT_SECRET is missing; cannot verify internal GraphQL requests`
      );
      return res.status(500).json({ error: 'Service misconfiguration' });
    }

    try {
      verifyInternalToken(internalToken, internalJwtSecret);
      return next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid internal gateway token' });
    }
  };
}

module.exports = {
  createGraphqlAuthMiddleware,
};
