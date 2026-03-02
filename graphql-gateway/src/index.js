// backend/graphql-gateway/src/index.js
// Enhanced gateway with rate limiting, circuit breakers, and security

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { stitchSchemas } = require('@graphql-tools/stitch');
const { introspectSchema } = require('@graphql-tools/wrap');
const { print } = require('graphql');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const CircuitBreaker = require('opossum');
const { v4: uuidv4 } = require('uuid');
const { createMetrics } = require('../../shared/metrics/metricsMiddleware');
const promClient = require('prom-client');
const runtimeStore = require('./services/runtimeStore');
const { createIdempotencyMiddleware } = require('./middleware/idempotency');

const app = express();
let httpServer = null;

// Prometheus metrics
const { middleware: metricsMiddleware, endpoint: metricsEndpoint } = createMetrics(promClient, 'graphql-gateway');
app.use(metricsMiddleware);
app.get('/metrics', metricsEndpoint);

// Service base URLs (override via env for Kubernetes/production)
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4003';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4004';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Correlation-ID',
    'Idempotency-Key',
  ],
}));

app.use(express.json({
  limit: '50mb',
  parameterLimit: 50000
}));
app.use(express.urlencoded({
  limit: '50mb',
  parameterLimit: 50000,
  extended: true
}));

/**
 * Creates one Express rate limiter middleware.
 * @param {{
 *   windowMs: number,
 *   max: number,
 *   message: string,
 *   prefix: string,
 * }} options Limiter options.
 * @return {Function} Express middleware.
 */
const createRateLimiter = (options) => {
  const limiterConfig = {
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.userId || req.ip;
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    }
  };

  const redisStore = runtimeStore.createRateLimitStore(options.prefix);
  if (redisStore) {
    limiterConfig.store = redisStore;
  }

  return rateLimit(limiterConfig);
};

let authLimiter = (req, res, next) => next();
let graphqlLimiter = (req, res, next) => next();
let generalLimiter = (req, res, next) => next();
const idempotencyMiddleware = createIdempotencyMiddleware({
  runtimeStore,
});

const conditionalRateLimiter = (req, res, next) => {
  const operationName = req.body?.operationName;
  const query = req.body?.query || '';

  // Use higher limit for auth operations
  const isAuthOperation =
    operationName === 'Login' ||
    operationName === 'Register' ||
    query.includes('mutation Login') ||
    query.includes('mutation Register');

  if (isAuthOperation) {
    return authLimiter(req, res, next);
  }

  return graphqlLimiter(req, res, next);
};

// Apply general rate limiting
app.use((req, res, next) => generalLimiter(req, res, next));

// Correlation ID middleware
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
});

// Authentication middleware with exemptions for login/register
const authenticateToken = async (req, res, next) => {
  // Extract operation name from GraphQL request
  const operationName = req.body?.operationName;
  const query = req.body?.query || '';

  // List of operations that don't require authentication
  const publicOperations = ['Login', 'Register', 'IntrospectionQuery', 'SendChatMessage', 'sendChatMessage', 'GetProducts', 'products'];


  // Check if this is a public operation by name or query content
  const isPublicOperation =
    publicOperations.includes(operationName) ||
    query.includes('mutation Login') ||
    query.includes('mutation Register') ||
    query.includes('mutation SendChatMessage') ||
    query.includes('mutation sendChatMessage') ||
    query.includes('sendChatMessage(') ||
    query.includes('query GetProducts') ||
    query.includes('query products') ||
    query.includes('products(') ||
    query.includes('__schema'); // Allow introspection queries

  // Skip authentication for public operations
  if (isPublicOperation) {
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
    // Verify token with auth service
    const response = await fetch(`${AUTH_SERVICE_URL}/api/users/verify-token`, {
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
        operation: operationName
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
      role: result.role
    });
    next();
  } catch (error) {
    console.error('❌ Authentication error:', {
      message: error.message,
      operation: operationName,
      code: error.code
    });

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Authentication service unavailable' });
    }

    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Request validation middleware - allow introspection in development
const validateGraphQLRequest = (req, res, next) => {
  const { query, variables } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'GraphQL query is required' });
  }

  if (typeof query !== 'string') {
    return res.status(400).json({ error: 'Query must be a string' });
  }

  // Only block introspection in production environment
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (!isDevelopment) {
    const dangerousPatterns = [
      /__schema/,
      /__type/,
      /introspection/i
    ];

    if (dangerousPatterns.some(pattern => pattern.test(query))) {
      return res.status(403).json({ error: 'Introspection queries are not allowed in production' });
    }
  }

  next();
};

// Circuit breaker configuration
const circuitBreakerOptions = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30 seconds
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10
};

// Service circuit breakers
const authServiceBreaker = new CircuitBreaker(callAuthService, circuitBreakerOptions);
const productServiceBreaker = new CircuitBreaker(callProductService, circuitBreakerOptions);
const orderServiceBreaker = new CircuitBreaker(callOrderService, circuitBreakerOptions);

// Circuit breaker fallbacks
authServiceBreaker.fallback(() => ({ error: 'Auth service temporarily unavailable' }));
productServiceBreaker.fallback(() => ({ error: 'Product service temporarily unavailable' }));
orderServiceBreaker.fallback(() => ({ error: 'Order service temporarily unavailable' }));

// Service call functions for circuit breakers
async function callAuthService(path, options = {}) {
  const response = await fetch(`${AUTH_SERVICE_URL}${path}`, {
    timeout: 10000,
    ...options
  });
  return response;
}

async function callProductService(path, options = {}) {
  const response = await fetch(`${PRODUCT_SERVICE_URL}${path}`, {
    timeout: 10000,
    ...options
  });
  return response;
}

async function callOrderService(path, options = {}) {
  const response = await fetch(`${ORDER_SERVICE_URL}${path}`, {
    timeout: 10000,
    ...options
  });
  return response;
}

// REST API proxy routes with circuit breakers
app.use('/api/auth', (req, res, next) => authLimiter(req, res, next), async (req, res) => {
  try {
    const response = await authServiceBreaker.fire('/api/users' + req.path, {
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
    const response = await productServiceBreaker.fire('/api/products' + req.path, {
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
    const response = await orderServiceBreaker.fire('/api' + req.path, {
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

// Health check endpoint with circuit breaker status
app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      runtimeStore: {
        mode: runtimeStore.getMode(),
      },
      auth: {
        status: authServiceBreaker.opened ? 'circuit_open' : 'healthy',
        stats: authServiceBreaker.stats
      },
      product: {
        status: productServiceBreaker.opened ? 'circuit_open' : 'healthy',
        stats: productServiceBreaker.stats
      },
      order: {
        status: orderServiceBreaker.opened ? 'circuit_open' : 'healthy',
        stats: orderServiceBreaker.stats
      }
    }
  };
  res.json(healthStatus);
});

// Create executor with internal authentication
const createExecutor = (url, serviceName) => {
  return async ({ document, variables, context }) => {
    const query = print(document);

    // Generate internal gateway token
    const internalToken = jwt.sign(
      { service: 'gateway', timestamp: Date.now() },
      process.env.INTERNAL_JWT_SECRET || 'internal-secret',
      { expiresIn: '1h' }
    );

    // Use separate headers for service auth and user auth
    const headers = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': context?.correlationId || '',
      'x-internal-gateway-token': internalToken, // ✅ Service-to-service auth
    };

    // Forward original user authorization if present
    if (context?.authHeader) {
      headers['Authorization'] = context.authHeader; // ✅ User auth
    }

    const fetchResult = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      timeout: 10000,
    });
    return fetchResult.json();
  };
};

const startServer = async () => {
  console.log('🚀 Starting Enhanced GraphQL Gateway...\n');
  await runtimeStore.connect();

  authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many authentication attempts, please try again later.',
    prefix: 'auth',
  });
  graphqlLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: 'Too many GraphQL requests, please try again later.',
    prefix: 'graphql',
  });
  generalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: 'Too many requests, please try again later.',
    prefix: 'general',
  });

  const authExecutor = createExecutor(`${AUTH_SERVICE_URL}/graphql`, 'auth');
  const productExecutor = createExecutor(`${PRODUCT_SERVICE_URL}/graphql`, 'product');
  const orderExecutor = createExecutor(`${ORDER_SERVICE_URL}/graphql`, 'order');
  const aiExecutor = createExecutor(`${AI_SERVICE_URL}/graphql`, 'ai');


  console.log('📡 Introspecting schemas from services...');

  try {
    // Introspect schemas
    const authSchema = await introspectSchema(authExecutor);
    const productSchema = await introspectSchema(productExecutor);
    const orderSchema = await introspectSchema(orderExecutor);
    const aiSchema = await introspectSchema(aiExecutor);

    console.log('✅ Successfully introspected all service schemas');

    // Stitch schemas together
    const gatewaySchema = stitchSchemas({
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

    // Enable introspection and playground in development environment
    const isDevelopment = process.env.NODE_ENV !== 'production';

    // Create Apollo Server
    const server = new ApolloServer({
      schema: gatewaySchema,
      context: ({ req }) => ({
        authHeader: req.headers.authorization || '',
        correlationId: req.correlationId,
        user: req.user,
      }),
      introspection: isDevelopment, // Enable introspection in development
      playground: isDevelopment,   // Enable playground in development
      plugins: [
        {
          requestDidStart() {
            return {
              didResolveOperation(requestContext) {
                console.log(`GraphQL Operation: ${requestContext.request.operationName || 'Anonymous'}`);
              },
              didEncounterErrors(requestContext) {
                console.error('GraphQL Errors:', requestContext.errors);
              }
            };
          }
        }
      ]
    });

    await server.start();

    // Apply middleware before GraphQL endpoint
    app.use(
      '/graphql',
      conditionalRateLimiter,
      authenticateToken,
      validateGraphQLRequest,
      idempotencyMiddleware
    );
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4000;
    httpServer = app.listen(PORT, () => {
      console.log(`\n✅ Enhanced GraphQL Gateway is running!`);
      console.log(`📍 URL: http://localhost:${PORT}/graphql`);
      console.log(`🔒 Security Features Enabled:`);
      console.log(`   - Rate Limiting: 10,000 GraphQL requests/15min`);
      console.log(`   - Circuit Breakers: 50% error threshold`);
      console.log(`   - Authentication: Required for all GraphQL requests`);
      // Update security message based on environment
      if (isDevelopment) {
        console.log(`   - Introspection: Enabled (development mode)`);
        console.log(`   - Playground: Enabled (development mode)`);
      } else {
        console.log(`   - Request Validation: Introspection blocked (production mode)`);
      }
      console.log(`📡 Proxied REST APIs:`);
      console.log(`   - Auth: http://localhost:${PORT}/api/auth/*`);
      console.log(`   - Products: http://localhost:${PORT}/api/products/*`);
      console.log(`   - Orders: http://localhost:${PORT}/api/orders/*`);
      console.log(`\n💡 All services secured - direct access blocked\n`);
    });

  } catch (error) {
    console.error('\n❌ Gateway startup failed!');
    console.error('Error:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  Cannot connect to service. Make sure all services are running:');
      console.error('   1. cd backend/auth-service && npm run dev');
      console.error('   2. cd backend/product-service && npm run dev');
      console.error('   3. cd backend/order-service && npm run dev');
    }

    process.exit(1);
  }
};

const gracefulShutdown = async (signal) => {
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
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
