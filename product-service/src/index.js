// backend/product-service/src/index.js
// CHANGE: Added Kafka producer lifecycle management

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/productSchema');
const resolvers = require('./resolvers/productResolvers');
const productRoutes = require('./api/routes/productRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');
const kafkaConsumer = require('./kafka/kafkaConsumer');
// CHANGE: Import Kafka producer
const kafkaProducer = require('./kafka/kafkaProducer');

const app = express();

// Middleware
app.use(cors());
// CHANGE: Increase JSON payload limit to 50MB for product images
app.use(express.json({ limit: '50mb' }));
// CHANGE: Increase URL-encoded payload limit to 50MB
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

// REST API routes
app.use('/api/products', productRoutes);

// Error handling middleware
app.use(errorHandler);

// CHANGE: Add health check endpoint for debugging
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'product-service',
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
    
    // CHANGE: Connect Kafka producer on startup
    try {
      await kafkaProducer.connect();
    } catch (error) {
      console.warn('⚠️  Kafka producer connection failed, continuing without events:', error.message);
    }
    
    const server = new ApolloServer({
      typeDefs,
      resolvers,
      introspection: true,
      // CHANGE: Enable playground for debugging
      playground: true,
      context: ({ req }) => {
        // CHANGE: Ensure correlationId and log are always available in GraphQL context
        const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'unknown';
        
        // CHANGE: Create logger if not present (for GraphQL requests)
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
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4002;
    
    // CHANGE: Add error handler for server listen
    const httpServer = app.listen(PORT, () => {
      console.log(`🚀 Product Service running on http://localhost:${PORT}${server.graphqlPath}`);
      console.log(`📡 REST API available at http://localhost:${PORT}/api/products`);
      console.log(`🔍 GraphQL Playground: http://localhost:${PORT}${server.graphqlPath}`);
      
      // CHANGE: Start Kafka consumer AFTER server is listening (non-blocking)
      setImmediate(async () => {
        try {
          console.log('📡 Starting Kafka consumer...');
          await kafkaConsumer.start();
          console.log('✅ Kafka consumer started successfully');
        } catch (error) {
          console.warn('⚠️  Kafka consumer failed to start, continuing without event processing:', error.message);
          console.warn('⚠️  Product service will continue to work, but order events will not be processed');
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