// backend/auth-service/src/index.js
// CHANGE: Added GraphQL security and enhanced gateway integration

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

// REST API routes (for inter-service communication)
app.use('/api/users', userRoutes);

// Error handling middleware
app.use(errorHandler);

// CHANGE: Health check endpoint for gateway monitoring
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'auth-service',
    timestamp: new Date().toISOString()
  });
});

// CHANGE: Enable introspection in development for gateway schema stitching
const isDevelopment = process.env.NODE_ENV !== 'production';

// Apollo Server with security
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: isDevelopment, // CHANGE: Enable introspection in development
  playground: false,   // CHANGE: Keep playground disabled for security
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
    console.log('✅ MongoDB connected - Auth Service');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
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
  await connectDB();
  
  try {
    await kafkaProducer.connect();
  } catch (error) {
    console.warn('⚠️  Kafka connection failed, continuing without events:', error.message);
  }
  
  await server.start();
  
  // CHANGE: Apply auth middleware before GraphQL endpoint
  app.use('/graphql', graphqlAuthMiddleware);
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4001;
  
  // CHANGE: Bind to localhost only for security
  app.listen(PORT, 'localhost', () => {
    console.log(`🚀 Auth Service running on http://localhost:${PORT}`);
    console.log(`📡 REST API available at http://localhost:${PORT}/api/users`);
    console.log(`🔒 GraphQL endpoint secured at http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`⚠️  GraphQL only accessible via API Gateway`);
    // CHANGE: Log introspection status
    if (isDevelopment) {
      console.log(`🔍 Introspection enabled for gateway schema stitching`);
    }
  });
};

startServer();