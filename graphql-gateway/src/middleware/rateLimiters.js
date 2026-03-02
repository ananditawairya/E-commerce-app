/**
 * Creates a no-op limiter for bootstrap phase.
 * @return {import('express').RequestHandler} No-op middleware.
 */
function createPlaceholderLimiter() {
  return (req, res, next) => next();
}

/**
 * Creates one Express rate limiter middleware.
 * @param {{
 *   windowMs: number,
 *   max: number,
 *   message: string,
 *   prefix: string,
 *   skip?: (req: import('express').Request) => boolean,
 * }} options Limiter options.
 * @param {{
 *   createRateLimitStore: (prefix: string) => object|undefined,
 * }} runtimeStore Runtime store adapter.
 * @param {Function} rateLimitFactory express-rate-limit factory.
 * @return {import('express').RequestHandler} Express middleware.
 */
function createRateLimiter(options, runtimeStore, rateLimitFactory) {
  const limiterConfig = {
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.userId || req.ip,
    skip: (req) => {
      if (req.path === '/health') {
        return true;
      }
      if (typeof options.skip === 'function') {
        return options.skip(req);
      }
      return false;
    },
  };

  const redisStore = runtimeStore.createRateLimitStore(options.prefix);
  if (redisStore) {
    limiterConfig.store = redisStore;
  }

  return rateLimitFactory(limiterConfig);
}

/**
 * Creates all limiter instances used by the gateway.
 * @param {{
 *   createRateLimitStore: (prefix: string) => object|undefined,
 * }} runtimeStore Runtime store adapter.
 * @param {Function} rateLimitFactory express-rate-limit factory.
 * @return {{
 *   authLimiter: import('express').RequestHandler,
 *   graphqlLimiter: import('express').RequestHandler,
 *   generalLimiter: import('express').RequestHandler,
 * }} Limiter set.
 */
function buildLimiterSet(runtimeStore, rateLimitFactory) {
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many authentication attempts, please try again later.',
    prefix: 'auth',
  }, runtimeStore, rateLimitFactory);

  const graphqlLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: 'Too many GraphQL requests, please try again later.',
    prefix: 'graphql',
  }, runtimeStore, rateLimitFactory);

  const generalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: 'Too many requests, please try again later.',
    prefix: 'general',
    skip: (req) => req.path === '/graphql' || req.path.startsWith('/graphql/'),
  }, runtimeStore, rateLimitFactory);

  return {
    authLimiter,
    graphqlLimiter,
    generalLimiter,
  };
}

/**
 * Builds GraphQL limiter router that picks auth or general GraphQL limits.
 * @param {() => import('express').RequestHandler} getAuthLimiter Auth limiter getter.
 * @param {() => import('express').RequestHandler} getGraphqlLimiter Graphql limiter getter.
 * @return {import('express').RequestHandler} Conditional limiter middleware.
 */
function createConditionalRateLimiter(getAuthLimiter, getGraphqlLimiter) {
  return (req, res, next) => {
    const operationName = req.body?.operationName;
    const query = req.body?.query || '';

    const isAuthOperation =
      operationName === 'Login' ||
      operationName === 'Register' ||
      query.includes('mutation Login') ||
      query.includes('mutation Register');

    if (isAuthOperation) {
      return getAuthLimiter()(req, res, next);
    }

    return getGraphqlLimiter()(req, res, next);
  };
}

module.exports = {
  buildLimiterSet,
  createConditionalRateLimiter,
  createPlaceholderLimiter,
};
