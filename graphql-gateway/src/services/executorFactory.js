const { print } = require('graphql');

/**
 * Parses a positive integer environment variable with fallback.
 * @param {string} name Environment variable name.
 * @param {number} fallback Default value.
 * @return {number} Parsed positive integer.
 */
function parsePositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const baseCircuitBreakerOptions = {
  errorThresholdPercentage: parsePositiveIntEnv('CIRCUIT_BREAKER_ERROR_THRESHOLD', 50),
  resetTimeout: parsePositiveIntEnv('CIRCUIT_BREAKER_RESET_TIMEOUT', 30000),
  rollingCountTimeout: parsePositiveIntEnv('CIRCUIT_BREAKER_ROLLING_COUNT_TIMEOUT', 10000),
  rollingCountBuckets: parsePositiveIntEnv('CIRCUIT_BREAKER_ROLLING_COUNT_BUCKETS', 10),
};

/**
 * Builds circuit breaker options per downstream service.
 * @param {string} serviceName Downstream service name.
 * @return {object} Circuit breaker options.
 */
function resolveCircuitBreakerOptions(serviceName) {
  const sharedTimeoutMs = parsePositiveIntEnv('GATEWAY_GRAPHQL_TIMEOUT_MS', 10000);
  const aiTimeoutMs = parsePositiveIntEnv(
    'GATEWAY_AI_GRAPHQL_TIMEOUT_MS',
    Math.max(sharedTimeoutMs, 30000)
  );

  return {
    ...baseCircuitBreakerOptions,
    timeout: serviceName === 'ai' ? aiTimeoutMs : sharedTimeoutMs,
  };
}

/**
 * Reads JSON payload when available.
 * @param {Response} response Fetch response.
 * @return {Promise<object>} Parsed JSON or empty object.
 */
async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

/**
 * Creates one callable upstream GraphQL request function.
 * @param {{url: string, fetch: Function, requestTimeoutMs: number}} deps Dependencies.
 * @return {Function} Upstream request function.
 */
function buildGraphqlCaller({ url, fetch, requestTimeoutMs }) {
  return async ({ query, variables, headers }) => {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      timeout: requestTimeoutMs,
    });

    if (!response.ok) {
      const upstreamPayload = await readJsonSafely(response);
      const error = new Error(
        `Upstream GraphQL request failed: ${response.status} ${response.statusText || ''}`.trim()
      );
      error.status = response.status;
      error.upstreamPayload = upstreamPayload;
      throw error;
    }

    const payload = await readJsonSafely(response);
    const hasDataField = payload && Object.prototype.hasOwnProperty.call(payload, 'data');
    const hasErrorsField = payload && Array.isArray(payload.errors);

    if (!hasDataField && !hasErrorsField) {
      const error = new Error('Upstream GraphQL response payload is invalid');
      error.upstreamPayload = payload;
      throw error;
    }

    return payload;
  };
}

/**
 * Creates one GraphQL executor for schema stitching.
 * @param {{
 *   url: string,
 *   serviceName: string,
 *   fetch: Function,
 *   jwt: object,
 *   internalJwtSecret: string,
 *   CircuitBreaker: Function,
 * }} deps Dependencies.
 * @return {Function} Stitched schema executor.
 */
function createExecutor({
  url,
  serviceName,
  fetch,
  jwt,
  internalJwtSecret,
  CircuitBreaker,
}) {
  const circuitBreakerOptions = resolveCircuitBreakerOptions(serviceName);
  const breaker = new CircuitBreaker(
    buildGraphqlCaller({
      url,
      fetch,
      requestTimeoutMs: circuitBreakerOptions.timeout,
    }),
    circuitBreakerOptions
  );

  breaker.on('failure', (error) => {
    console.warn(
      `[gateway:${serviceName}] Upstream GraphQL failure: ${error?.message || 'unknown error'}`
    );
  });
  breaker.on('timeout', () => {
    console.warn(
      `[gateway:${serviceName}] Upstream GraphQL request timed out after ${circuitBreakerOptions.timeout}ms`
    );
  });
  breaker.on('open', () => {
    console.warn(`[gateway:${serviceName}] Circuit breaker opened`);
  });
  breaker.on('close', () => {
    console.log(`[gateway:${serviceName}] Circuit breaker closed`);
  });

  breaker.fallback(() => ({
    data: null,
    errors: [
      {
        message: `${serviceName} GraphQL service temporarily unavailable`,
        extensions: {
          code: 'SERVICE_UNAVAILABLE',
          service: serviceName,
        },
      },
    ],
  }));

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

    return breaker.fire({ query, variables, headers });
  };
}

module.exports = {
  createExecutor,
};
