// backend/product-service/src/index.js
// CHANGE: Added GraphQL security and enhanced gateway integration

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

const app = express();

// CHANGE: GraphQL Authentication Middleware to prevent direct access
const graphqlAuthMiddleware = (req, res, next) => {
  const internalToken = req.headers['x-internal-gateway-token'];
  
  // CHANGE: Verify internal gateway token for service-to-service auth
  if (!internalToken) {
    return res.status(403).json({ 
      error: 'Direct GraphQL access forbidden. Use API Gateway at http://localhost:4000/graphql' 
    });
  }
  
  try {
    // CHANGE: Verify internal gateway token
    jwt.verify(internalToken, process.env.INTERNAL_JWT_SECRET || 'internal-secret');
    
    // CHANGE: Allow request to proceed - user auth will be handled by resolvers
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid internal gateway token' });
  }
};

// Middleware
app.use(cors({
  // CHANGE: Only allow gateway origin for GraphQL
  origin: process.env.GATEWAY_URL || 'http://localhost:4000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

// CHANGE: Add debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path} - Headers: ${JSON.stringify(req.headers, null, 2)}`);
  next();
});

// REST API routes
app.use('/api/products', productRoutes);

app.get('/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach(handler => {
        if (handler.route) {
          const basePath = middleware.regexp.source.replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
          routes.push({
            path: basePath + handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  res.json({ routes });
});

// Error handling middleware
app.use(errorHandler);

// CHANGE: Health check endpoint for gateway monitoring
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'product-service',
    timestamp: new Date().toISOString()
  });
});

// CHANGE: Add route debugging endpoint
app.get('/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: `/api/products${handler.route.path}`,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  res.json({ routes });
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
    
    try {
      await kafkaProducer.connect();
    } catch (error) {
      console.warn('⚠️  Kafka producer connection failed, continuing without events:', error.message);
    }
    
    // CHANGE: Enable introspection in development for gateway schema stitching
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    const server = new ApolloServer({
      typeDefs,
      resolvers,
      introspection: isDevelopment, // CHANGE: Enable introspection in development
      playground: false,   // CHANGE: Keep playground disabled for security
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
    
    // CHANGE: Apply auth middleware before GraphQL endpoint
    app.use('/graphql', graphqlAuthMiddleware);
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4002;
    
    // CHANGE: Bind to localhost only for security
    const httpServer = app.listen(PORT, 'localhost', () => {
      console.log(`🚀 Product Service running on http://localhost:${PORT}`);
      console.log(`📡 REST API available at http://localhost:${PORT}/api/products`);
      console.log(`🔒 GraphQL endpoint secured at http://localhost:${PORT}${server.graphqlPath}`);
      console.log(`⚠️  GraphQL only accessible via API Gateway`);
      console.log(`🔍 Debug routes at http://localhost:${PORT}/debug/routes`);
      // CHANGE: Log introspection status
      if (isDevelopment) {
        console.log(`🔍 Introspection enabled for gateway schema stitching`);
      }
      
      // CHANGE: Log all registered routes for debugging
      console.log('\n📋 Registered Routes:');
      app._router.stack.forEach((middleware) => {
        if (middleware.route) {
          console.log(`  ${Object.keys(middleware.route.methods).join(', ').toUpperCase()} ${middleware.route.path}`);
        } else if (middleware.name === 'router' && middleware.regexp.source.includes('api/products')) {
          console.log('  Product API Routes:');
          middleware.handle.stack.forEach((handler) => {
            if (handler.route) {
              console.log(`    ${Object.keys(handler.route.methods).join(', ').toUpperCase()} /api/products${handler.route.path}`);
            }
          });
        }
      });
      
      // CHANGE: Start periodic cleanup for expired reservations
      const productService = require('./services/productService');
      setInterval(async () => {
        try {
          await productService.cleanupAllExpiredReservations();
        } catch (error) {
          console.error('Periodic cleanup error:', error.message);
        }
      }, 60000); // CHANGE: Run cleanup every minute
      
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