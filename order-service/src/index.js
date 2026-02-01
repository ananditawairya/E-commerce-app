// backend/order-service/src/index.js
// CHANGE: Added Kafka producer lifecycle management

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
// CHANGE: Import Kafka producer
const kafkaProducer = require('./kafka/kafkaProducer');

const app = express();

// Middleware
app.use(cors());
// CHANGE: Increase JSON payload limit to 50MB
app.use(express.json({ limit: '50mb' }));
// CHANGE: Increase URL-encoded payload limit to 50MB
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

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected - Order Service');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// CHANGE: Graceful shutdown handler
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
  await connectDB();
  
  // CHANGE: Connect Kafka producer on startup
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