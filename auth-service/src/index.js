// backend/auth-service/src/index.js

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/authSchema');
const resolvers = require('./resolvers/authResolvers');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
});

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected - Auth Service');
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

  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => {
    console.log(`🚀 Auth Service running on http://localhost:${PORT}${server.graphqlPath}`);
  });
};

startServer();