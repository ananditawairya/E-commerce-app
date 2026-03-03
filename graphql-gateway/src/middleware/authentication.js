/**
 * Checks whether an operation can bypass authentication.
 * @param {string|undefined} operationName GraphQL operation name.
 * @param {string} query GraphQL query document.
 * @return {boolean} True when operation is public.
 */
function isPublicOperation(operationName, query) {
  const publicOperationNames = new Set([
    'Login',
    'Register',
    'IntrospectionQuery',
    'SendChatMessage',
    'GetProducts',
    'GetProduct',
    'GetCategories',
    'GetSearchSuggestions',
    'GetTrendingProducts',
    'GetSimilarProducts',
  ]);

  if (typeof operationName === 'string' && publicOperationNames.has(operationName)) {
    return true;
  }

  const publicQueryMarkers = [
    'query GetProducts',
    'query GetProduct',
    'query GetCategories',
    'query GetSearchSuggestions',
    'query GetTrendingProducts',
    'query GetSimilarProducts',
    'products(',
    'product(',
    'searchSuggestions(',
    'getTrendingProducts(',
    'getSimilarProducts(',
  ];

  const publicMutationMarkers = [
    'mutation Login',
    'mutation Register',
    'mutation SendChatMessage',
    'sendChatMessage(',
  ];

  return (
    publicQueryMarkers.some((marker) => query.includes(marker)) ||
    publicMutationMarkers.some((marker) => query.includes(marker)) ||
    query.includes('__schema')
  );
}

/**
 * Creates authentication middleware that validates user token via auth service.
 * @param {{
 *   authServiceUrl: string,
 *   fetch: Function,
 * }} deps Dependencies.
 * @return {import('express').RequestHandler} Express auth middleware.
 */
function createAuthenticateToken({ authServiceUrl, fetch }) {
  return async (req, res, next) => {
    const operationName = req.body?.operationName;
    const query = req.body?.query || '';

    if (isPublicOperation(operationName, query)) {
      console.log(`⚠️  Skipping auth for public operation: ${operationName || 'unnamed'}`);
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.error('❌ No token provided for protected operation:', operationName);
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const response = await fetch(`${authServiceUrl}/api/users/verify-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': req.correlationId,
        },
        body: JSON.stringify({ token }),
        timeout: 5000,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Token verification failed:', {
          status: response.status,
          error: errorData,
          operation: operationName,
        });
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      const result = await response.json();
      if (!result.valid) {
        console.error('❌ Token marked as invalid:', { operation: operationName });
        return res.status(403).json({ error: 'Invalid token' });
      }

      req.user = result;
      console.log(`✅ Auth successful for ${operationName}:`, {
        userId: result.userId,
        role: result.role,
      });
      return next();
    } catch (error) {
      console.error('❌ Authentication error:', {
        message: error.message,
        operation: operationName,
        code: error.code,
      });

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({ error: 'Authentication service unavailable' });
      }

      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

module.exports = {
  createAuthenticateToken,
  isPublicOperation,
};
