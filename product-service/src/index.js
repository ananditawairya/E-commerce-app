require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/productSchema');
const resolvers = require('./resolvers/productResolvers');

const app = express();

// Middleware
app.use(cors());
// CHANGE: Increase payload limits for large image uploads
app.use(express.json({ 
  limit: '50mb',  // Increased from default 1mb to handle base64 images
  parameterLimit: 50000 
}));
app.use(express.urlencoded({ 
  limit: '50mb', 
  extended: true,
  parameterLimit: 50000 
}));

// CHANGE: Add request logging middleware BEFORE Apollo
app.use((req, res, next) => {
  console.log('📨 Incoming request:', {
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'],
    bodySize: req.headers['content-length'],
    hasAuth: !!req.headers.authorization,
  });
  next();
});

// Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  context: ({ req }) => ({ req }),
  formatError: (error) => {
    console.error('❌ GraphQL Error:', {
      message: error.message,
      path: error.path,
      extensions: error.extensions,
      originalError: error.originalError?.message,
      stack: error.extensions?.exception?.stacktrace,
    });
    return error;
  },
  // CHANGE: Add plugin to log GraphQL operations
  plugins: [
    {
      async requestDidStart(requestContext) {
        console.log('🔍 GraphQL Operation:', {
          operationName: requestContext.request.operationName,
          query: requestContext.request.query?.substring(0, 100) + '...',
        });
        
        return {
          async didEncounterErrors(ctx) {
            console.error('💥 GraphQL execution errors:', ctx.errors);
          },
        };
      },
    },
  ],
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

// Start server
const startServer = async () => {
  await connectDB();
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => {
    console.log(`🚀 Product Service running on http://localhost:${PORT}${server.graphqlPath}`);
  });
};

startServer();