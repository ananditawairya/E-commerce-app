// backend/order-service/src/index.js
// CHANGE: Ensure MongoDB connects before saga coordinator initialization

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/orderSchema');
const resolvers = require('./resolvers/orderResolvers');
const orderRoutes = require('./api/routes/orderRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');
const kafkaProducer = require('./kafka/kafkaProducer');
const { initializeSagaCoordinator } = require('./services/orderService');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

// REST API routes
app.use('/api', orderRoutes);

// Error handling middleware
app.use(errorHandler);

// Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  context: ({ req }) => ({
    req,
    correlationId: req.correlationId,
    log: req.log,
  }),
});

// CHANGE: Enhanced database connection with retry logic
const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        // CHANGE: Increase timeouts for saga operations
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
      });
      
      // CHANGE: Wait for connection to be ready
      await mongoose.connection.asPromise();
      
      console.log('✅ MongoDB connected - Order Service');
      return;
    } catch (error) {
      retryCount++;
      console.error(`❌ MongoDB connection attempt ${retryCount}/${maxRetries} failed:`, error.message);
      
      if (retryCount >= maxRetries) {
        console.error('❌ MongoDB connection failed after maximum retries');
        process.exit(1);
      }
      
      // CHANGE: Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    await kafkaProducer.disconnect();
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
  // CHANGE: Connect to MongoDB FIRST before any other initialization
  await connectDB();
  
  // CHANGE: Initialize saga coordinator AFTER MongoDB is connected
  try {
    await initializeSagaCoordinator();
    console.log('✅ Saga coordinator initialized');
  } catch (error) {
    console.error('❌ Saga coordinator initialization failed:', error.message);
    process.exit(1);
  }
  
  // CHANGE: Connect Kafka producer after saga coordinator
  try {
    await kafkaProducer.connect();
  } catch (error) {
    console.warn('⚠️  Kafka connection failed, continuing without events:', error.message);
  }
  
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4003;
  app.listen(PORT, () => {
    console.log(`🚀 Order Service running on http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`📡 REST API available at http://localhost:${PORT}/api`);
  });
};

startServer();