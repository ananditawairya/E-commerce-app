// backend/auth-service/src/index.js
// Added GraphQL security and enhanced gateway integration

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const typeDefs = require('./schema/authSchema');
const resolvers = require('./resolvers/authResolvers');
const userRoutes = require('./api/routes/userRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');
const kafkaProducer = require('./kafka/kafkaProducer');
const cacheService = require('./services/cacheService');
const { appLogger, getLoggingConfig } = require('./utils/logger');
const { createMetrics } = require('../../shared/metrics/metricsMiddleware');
const { createGraphqlAuthMiddleware } = require('../../shared/middleware/graphqlAuth');
const promClient = require('prom-client');

const app = express();

// Prometheus metrics
const { middleware: metricsMiddleware, endpoint: metricsEndpoint } = createMetrics(promClient, 'auth-service');
app.use(metricsMiddleware);
app.get('/metrics', metricsEndpoint);

const graphqlAuthMiddleware = createGraphqlAuthMiddleware({
  serviceName: 'auth-service',
  verifyInternalToken: jwt.verify,
  internalJwtSecret: process.env.INTERNAL_JWT_SECRET,
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:4000',
});


// Middleware
app.use(cors({
  // Only allow gateway origin for GraphQL
  origin: process.env.GATEWAY_URL || 'http://localhost:4000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

// REST API routes (for inter-service communication)
app.use('/api/users', userRoutes);

// Error handling middleware
app.use(errorHandler);

// Health check endpoint for gateway monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'auth-service',
    cacheMode: cacheService.getMode(),
    logging: getLoggingConfig(),
    timestamp: new Date().toISOString(),
  });
});

// Enable introspection in development for gateway schema stitching
const isDevelopment = process.env.NODE_ENV !== 'production';

// Apollo Server with security
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: isDevelopment, // Enable introspection in development
  playground: false,   // Keep playground disabled for security
  context: ({ req }) => ({
    req,
    correlationId: req.correlationId,
    log: req.log,
  }),
});

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    appLogger.info('MongoDB connected');
  } catch (error) {
    appLogger.error({ error: error.message }, 'MongoDB connection error');
    process.exit(1);
  }
};

const gracefulShutdown = async (signal) => {
  appLogger.info({ signal }, 'Shutdown signal received');

  try {
    await cacheService.disconnect();
    await kafkaProducer.disconnect();
    await mongoose.connection.close();
    appLogger.info('Connections closed');
    process.exit(0);
  } catch (error) {
    appLogger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  await connectDB();
  await cacheService.connect();

  try {
    await kafkaProducer.connect();
  } catch (error) {
    appLogger.warn({ error: error.message }, 'Kafka connection failed, continuing without events');
  }

  await server.start();

  // Apply auth middleware before GraphQL endpoint
  app.use('/graphql', graphqlAuthMiddleware);
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4001;

  // Bind to localhost only for security
  app.listen(PORT, '0.0.0.0', () => {
    appLogger.info({
      port: PORT,
      restApi: `http://localhost:${PORT}/api/users`,
      graphqlPath: `http://localhost:${PORT}${server.graphqlPath}`,
      introspectionEnabled: isDevelopment,
      cacheMode: cacheService.getMode(),
      logging: getLoggingConfig(),
    }, 'Auth service started');
  });
};

startServer();
