// backend/order-service/src/index.js
// CHANGE: Modified to include REST API server

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/orderSchema');
const resolvers = require('./resolvers/orderResolvers');
// CHANGE: Import REST API components
const orderRoutes = require('./api/routes/orderRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// CHANGE: Add logging middleware
app.use(logger);

// CHANGE: Mount REST API routes
app.use('/api', orderRoutes);

// CHANGE: Add error handling middleware (must be after routes)
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

// Start server
const startServer = async () => {
  await connectDB();
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4003;
  app.listen(PORT, () => {
    console.log(`🚀 Order Service running on http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`📡 REST API available at http://localhost:${PORT}/api`);
  });
};

startServer();