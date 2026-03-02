const { print } = require('graphql');

/**
 * Creates one GraphQL executor for schema stitching.
 * @param {{
 *   url: string,
 *   fetch: Function,
 *   jwt: object,
 *   internalJwtSecret: string,
 * }} deps Dependencies.
 * @return {Function} Stitched schema executor.
 */
function createExecutor({ url, fetch, jwt, internalJwtSecret }) {
  return async ({ document, variables, context }) => {
    const query = print(document);
    const internalToken = jwt.sign(
      { service: 'gateway', timestamp: Date.now() },
      internalJwtSecret,
      { expiresIn: '1h' }
    );

    const headers = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': context?.correlationId || '',
      'x-internal-gateway-token': internalToken,
    };

    if (context?.authHeader) {
      headers.Authorization = context.authHeader;
    }

    const fetchResult = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      timeout: 10000,
    });
    return fetchResult.json();
  };
}

module.exports = {
  createExecutor,
};
