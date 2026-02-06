// ai-service/src/schema/recommendationSchema.js

const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Recommendation {
    productId: ID!
    score: Float!
    reason: String!
    category: String
  }

  type TrackEventResponse {
    success: Boolean!
    message: String
  }

  # Chatbot types
  type ChatVariant {
    id: ID!
    name: String!
    priceModifier: Float!
    stock: Int!
  }

  type ChatProduct {
    id: ID!
    name: String!
    description: String
    category: String
    basePrice: Float!
    images: [String]
    variants: [ChatVariant]
  }

  type ChatResponse {
    message: String!
    products: [ChatProduct!]!
    conversationId: String!
    followUpQuestion: String
    appliedFilters: [String!]!
    latencyMs: Int
    cacheHit: Boolean!
    safetyBlocked: Boolean!
    semanticUsed: Boolean!
  }

  type Query {
    # Get personalized recommendations for a user
    getRecommendations(userId: ID!, limit: Int): [Recommendation!]!
    
    # Get similar products based on a product
    getSimilarProducts(productId: ID!, limit: Int): [Recommendation!]!
    
    # Get trending products (optionally by category)
    getTrendingProducts(category: String, limit: Int): [Recommendation!]!
    
    # Get user's recently viewed products
    getRecentlyViewed(userId: ID!, limit: Int): [Recommendation!]!
  }

  type Mutation {
    # Track a user behavior event
    trackEvent(
      userId: ID!
      productId: ID!
      eventType: String!
      category: String
      metadata: String
    ): TrackEventResponse!

    # AI Shopping Assistant - Send a chat message
    sendChatMessage(
      userId: ID!
      message: String!
      conversationId: String
    ): ChatResponse!
  }
`;

module.exports = typeDefs;
