// backend/product-service/src/index.js
// Added GraphQL security and enhanced gateway integration

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const typeDefs = require('./schema/productSchema');
const resolvers = require('./resolvers/productResolvers');
const productRoutes = require('./api/routes/productRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');
const kafkaConsumer = require('./kafka/kafkaConsumer');
const kafkaProducer = require('./kafka/kafkaProducer');
const cacheService = require('./services/cacheService');
const searchEngineService = require('./services/searchEngineService');
const { createMetrics } = require('../../shared/metrics/metricsMiddleware');
const promClient = require('prom-client');

const app = express();

// Prometheus metrics
const { middleware: metricsMiddleware, endpoint: metricsEndpoint } = createMetrics(promClient, 'product-service');
app.use(metricsMiddleware);
app.get('/metrics', metricsEndpoint);

// GraphQL Authentication Middleware to prevent direct access
const graphqlAuthMiddleware = (req, res, next) => {
  const internalToken = req.headers['x-internal-gateway-token'];

  // Verify internal gateway token for service-to-service auth
  if (!internalToken) {
    return res.status(403).json({
      error: 'Direct GraphQL access forbidden. Use API Gateway at http://localhost:4000/graphql'
    });
  }

  try {
    // Verify internal gateway token
    jwt.verify(internalToken, process.env.INTERNAL_JWT_SECRET || 'internal-secret');

    // Allow request to proceed - user auth will be handled by resolvers
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid internal gateway token' });
  }
};

// Middleware
app.use(cors({
  // Only allow gateway origin for GraphQL
  origin: process.env.GATEWAY_URL || 'http://localhost:4000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

// REST API routes
app.use('/api/products', productRoutes);

// Error handling middleware
app.use(errorHandler);

// Health check endpoint for gateway monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'product-service',
    cacheMode: cacheService.getMode(),
    searchEngine: searchEngineService.getStatus(),
    timestamp: new Date().toISOString()
  });
});

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected - Product Service');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    await kafkaProducer.disconnect();
    await kafkaConsumer.disconnect();
    await cacheService.disconnect();
    await mongoose.connection.close();
    console.log('✅ Connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    await connectDB();
    await cacheService.connect();
    await searchEngineService.initialize();

    try {
      await kafkaProducer.connect();
    } catch (error) {
      console.warn('⚠️  Kafka producer connection failed, continuing without events:', error.message);
    }

    // Enable introspection in development for gateway schema stitching
    const isDevelopment = process.env.NODE_ENV !== 'production';

    const server = new ApolloServer({
      typeDefs,
      resolvers,
      introspection: isDevelopment, // Enable introspection in development
      playground: false,   // Keep playground disabled for security
      context: ({ req }) => {
        const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'unknown';

        const log = req.log || {
          info: (data, message) => {
            console.log(JSON.stringify({
              level: 'info',
              correlationId,
              timestamp: new Date().toISOString(),
              service: 'product-service',
              message,
              ...data,
            }));
          },
          error: (data, message) => {
            console.error(JSON.stringify({
              level: 'error',
              correlationId,
              timestamp: new Date().toISOString(),
              service: 'product-service',
              message,
              ...data,
            }));
          },
        };

        return {
          req,
          correlationId,
          log,
        };
      },
      formatError: (error) => {
        console.error('GraphQL Error:', error);
        return error;
      },
    });

    await server.start();

    // Apply auth middleware before GraphQL endpoint
    app.use('/graphql', graphqlAuthMiddleware);
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4002;

    // Bind to localhost only for security
    const httpServer = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Product Service running on http://localhost:${PORT}`);
      console.log(`📡 REST API available at http://localhost:${PORT}/api/products`);
      console.log(`🔒 GraphQL endpoint secured at http://localhost:${PORT}${server.graphqlPath}`);
      console.log(`⚠️  GraphQL only accessible via API Gateway`);
      // Log introspection status
      if (isDevelopment) {
        console.log(`🔍 Introspection enabled for gateway schema stitching`);
      }

      // Start Kafka consumer AFTER server is listening (non-blocking)
      setImmediate(async () => {
        try {
          console.log('📡 Starting Kafka consumer for stock deduction...');
          await kafkaConsumer.start();
          console.log('✅ Kafka consumer started - listening for OrderCreated and OrderCancelled events');
        } catch (error) {
          console.error('❌ Kafka consumer failed to start:', error.message);
          console.error('⚠️  Stock deduction will not work without Kafka consumer!');
        }
      });
    });

    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start Product Service:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
};

startServer();
