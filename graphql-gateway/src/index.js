require('dotenv').config();

const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { stitchSchemas } = require('@graphql-tools/stitch');
const { introspectSchema } = require('@graphql-tools/wrap');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const CircuitBreaker = require('opossum');
const promClient = require('prom-client');
const { createMetrics } = require('../../shared/metrics/metricsMiddleware');
const runtimeStore = require('./services/runtimeStore');
const { createExecutor } = require('./services/executorFactory');
const { createCircuitBreakers } = require('./services/circuitBreakerService');
const { createIdempotencyMiddleware } = require('./middleware/idempotency');
const {
  buildLimiterSet,
  createConditionalRateLimiter,
  createPlaceholderLimiter,
} = require('./middleware/rateLimiters');
const { applySecurityMiddleware } = require('./middleware/security');
const { correlationMiddleware } = require('./middleware/correlation');
const { createAuthenticateToken } = require('./middleware/authentication');
const { validateGraphQLRequest } = require('./middleware/requestValidation');
const { registerRestProxyRoutes } = require('./routes/restProxy');
const { registerHealthRoute } = require('./routes/health');
const { getServiceUrls } = require('./config/serviceUrls');

const app = express();
let httpServer = null;

const serviceUrls = getServiceUrls();
const internalJwtSecret = process.env.INTERNAL_JWT_SECRET;

const { middleware: metricsMiddleware, endpoint: metricsEndpoint } = createMetrics(
  promClient,
  'graphql-gateway'
);
app.use(metricsMiddleware);
app.get('/metrics', metricsEndpoint);

applySecurityMiddleware(app);
app.use(correlationMiddleware);

let authLimiter = createPlaceholderLimiter();
let graphqlLimiter = createPlaceholderLimiter();
let generalLimiter = createPlaceholderLimiter();

const getAuthLimiter = () => authLimiter;
const getGraphqlLimiter = () => graphqlLimiter;
const conditionalRateLimiter = createConditionalRateLimiter(
  getAuthLimiter,
  getGraphqlLimiter
);

app.use((req, res, next) => generalLimiter(req, res, next));

const authenticateToken = createAuthenticateToken({
  authServiceUrl: serviceUrls.auth,
  fetch,
});
const idempotencyMiddleware = createIdempotencyMiddleware({ runtimeStore });
const circuitBreakers = createCircuitBreakers({
  serviceUrls,
  fetch,
  CircuitBreaker,
});

registerRestProxyRoutes({
  app,
  getAuthLimiter,
  authenticateToken,
  circuitBreakers,
});
registerHealthRoute({ app, runtimeStore, circuitBreakers });

/**
 * Creates the stitched gateway schema by introspecting downstream services.
 * @return {Promise<object>} Stitched GraphQL schema.
 */
async function buildGatewaySchema() {
  const authExecutor = createExecutor({
    url: `${serviceUrls.auth}/graphql`,
    serviceName: 'auth',
    fetch,
    jwt,
    internalJwtSecret,
    CircuitBreaker,
  });
  const productExecutor = createExecutor({
    url: `${serviceUrls.product}/graphql`,
    serviceName: 'product',
    fetch,
    jwt,
    internalJwtSecret,
    CircuitBreaker,
  });
  const orderExecutor = createExecutor({
    url: `${serviceUrls.order}/graphql`,
    serviceName: 'order',
    fetch,
    jwt,
    internalJwtSecret,
    CircuitBreaker,
  });
  const aiExecutor = createExecutor({
    url: `${serviceUrls.ai}/graphql`,
    serviceName: 'ai',
    fetch,
    jwt,
    internalJwtSecret,
    CircuitBreaker,
  });

  console.log('📡 Introspecting schemas from services...');

  const authSchema = await introspectSchema(authExecutor);
  const productSchema = await introspectSchema(productExecutor);
  const orderSchema = await introspectSchema(orderExecutor);
  const aiSchema = await introspectSchema(aiExecutor);

  console.log('✅ Successfully introspected all service schemas');

  return stitchSchemas({
    subschemas: [
      {
        schema: authSchema,
        executor: authExecutor,
      },
      {
        schema: productSchema,
        executor: productExecutor,
      },
      {
        schema: orderSchema,
        executor: orderExecutor,
      },
      {
        schema: aiSchema,
        executor: aiExecutor,
      },
    ],
  });
}

/**
 * Creates and starts Apollo Server middleware.
 * @param {object} gatewaySchema Stitched GraphQL schema.
 * @return {Promise<void>} Completion promise.
 */
async function setupApolloServer(gatewaySchema) {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const server = new ApolloServer({
    schema: gatewaySchema,
    context: ({ req }) => ({
      authHeader: req.headers.authorization || '',
      correlationId: req.correlationId,
      user: req.user,
    }),
    introspection: isDevelopment,
    playground: isDevelopment,
    plugins: [
      {
        requestDidStart() {
          return {
            didResolveOperation(requestContext) {
              console.log(
                `GraphQL Operation: ${requestContext.request.operationName || 'Anonymous'}`
              );
            },
            didEncounterErrors(requestContext) {
              console.error('GraphQL Errors:', requestContext.errors);
            },
          };
        },
      },
    ],
  });

  await server.start();

  app.use(
    '/graphql',
    conditionalRateLimiter,
    authenticateToken,
    validateGraphQLRequest,
    idempotencyMiddleware
  );
  server.applyMiddleware({ app, path: '/graphql' });
}

/**
 * Logs gateway startup summary.
 * @param {number|string} port Server port.
 * @return {void}
 */
function logStartupSummary(port) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  console.log('\n✅ Enhanced GraphQL Gateway is running!');
  console.log(`📍 URL: http://localhost:${port}/graphql`);
  console.log('🔒 Security Features Enabled:');
  console.log('   - Rate Limiting: 10,000 GraphQL requests/15min');
  console.log('   - Circuit Breakers: 50% error threshold');
  console.log('   - Authentication: Required for all GraphQL requests');

  if (isDevelopment) {
    console.log('   - Introspection: Enabled (development mode)');
    console.log('   - Playground: Enabled (development mode)');
  } else {
    console.log('   - Request Validation: Introspection blocked (production mode)');
  }

  console.log('📡 Proxied REST APIs:');
  console.log(`   - Auth: http://localhost:${port}/api/auth/*`);
  console.log(`   - Products: http://localhost:${port}/api/products/*`);
  console.log(`   - Orders: http://localhost:${port}/api/orders/*`);
  console.log('\n💡 All services secured - direct access blocked\n');
}

/**
 * Starts the GraphQL gateway service.
 * @return {Promise<void>} Completion promise.
 */
async function startServer() {
  console.log('🚀 Starting Enhanced GraphQL Gateway...\n');

  if (typeof internalJwtSecret !== 'string' || !internalJwtSecret.trim()) {
    throw new Error(
      'INTERNAL_JWT_SECRET is required for internal GraphQL authentication'
    );
  }

  await runtimeStore.connect();
  ({ authLimiter, graphqlLimiter, generalLimiter } = buildLimiterSet(
    runtimeStore,
    rateLimit
  ));

  const gatewaySchema = await buildGatewaySchema();
  await setupApolloServer(gatewaySchema);

  const port = process.env.PORT || 4000;
  httpServer = app.listen(port, () => {
    logStartupSummary(port);
  });
}

/**
 * Shuts down gateway resources gracefully.
 * @param {string} signal Process signal name.
 * @return {Promise<void>} Completion promise.
 */
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down GraphQL Gateway...`);
  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    await runtimeStore.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Failed to shutdown GraphQL Gateway gracefully:', error.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

startServer().catch((error) => {
  console.error('\n❌ Gateway startup failed!');
  console.error('Error:', error.message);

  if (error.code === 'ECONNREFUSED') {
    console.error('\n⚠️  Cannot connect to service. Make sure all services are running:');
    console.error('   1. cd backend/auth-service && npm run dev');
    console.error('   2. cd backend/product-service && npm run dev');
    console.error('   3. cd backend/order-service && npm run dev');
  }

  process.exit(1);
});
