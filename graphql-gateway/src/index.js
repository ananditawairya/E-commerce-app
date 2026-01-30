// backend/graphql-gateway/src/index.js
// THIS VERSION DOES NOT REQUIRE FEDERATION IN SERVICES

require('dotenv').config();
const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { stitchSchemas } = require('@graphql-tools/stitch');
const { introspectSchema } = require('@graphql-tools/wrap');
const { AsyncExecutor } = require('@graphql-tools/utils');
const { print } = require('graphql');
const fetch = require('node-fetch');
const cors = require('cors');
// CHANGE: Add UUID for correlation ID generation
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({
  limit:'50mb',
  parameterLimit:50000
}));

// CHANGE: Add correlation ID middleware
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
});

// Create executor for each service
const createExecutor = (url) => {
  return async ({ document, variables, context }) => {
    const query = print(document);
    const fetchResult = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // CHANGE: Propagate correlation ID to downstream services
        'X-Correlation-ID': context?.correlationId || '',
        ...(context?.authHeader && { authorization: context.authHeader }),
      },
      body: JSON.stringify({ query, variables }),
    });
    return fetchResult.json();
  };
};

const startServer = async () => {
  console.log('🚀 Starting GraphQL Gateway (Schema Stitching)...\n');

  // CHANGE: Use environment variables for service URLs
  const authExecutor = createExecutor(process.env.AUTH_SERVICE_URL || 'http://localhost:4001/graphql');
  const productExecutor = createExecutor(process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002/graphql');
  const orderExecutor = createExecutor(process.env.ORDER_SERVICE_URL || 'http://localhost:4003/graphql');

  console.log('📡 Introspecting schemas from services...');

  try {
    // Introspect schemas
    const authSchema = await introspectSchema(authExecutor);
    const productSchema = await introspectSchema(productExecutor);
    const orderSchema = await introspectSchema(orderExecutor);

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
      ],
    });

    // Create Apollo Server
    const server = new ApolloServer({
      schema: gatewaySchema,
      context: ({ req }) => ({
        authHeader: req.headers.authorization || '',
        // CHANGE: Pass correlation ID to GraphQL context
        correlationId: req.correlationId,
      }),
      introspection: true,
      playground: true,
    });

    await server.start();
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
      console.log(`\n✅ GraphQL Gateway is running!`);
      console.log(`📍 URL: http://localhost:${PORT}/graphql`);
      console.log(`📡 Stitched services:`);
      console.log(`   - Auth Service: ${process.env.AUTH_SERVICE_URL || 'http://localhost:4001/graphql'}`);
      console.log(`   - Product Service: ${process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002/graphql'}`);
      console.log(`   - Order Service: ${process.env.ORDER_SERVICE_URL || 'http://localhost:4003/graphql'}`);
      console.log(`\n💡 Open http://localhost:${PORT}/graphql in your browser\n`);
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

startServer();