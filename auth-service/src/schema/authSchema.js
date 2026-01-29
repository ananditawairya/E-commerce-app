// backend/auth-service/src/schema/authSchema.js

const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: String!
  }

  type AuthPayload {
    user: User!
    accessToken: String!
    refreshToken: String!
  }

  type RefreshPayload {
    accessToken: String!
  }

  type VerifyPayload {
    userId: ID!
    role: String!
    valid: Boolean!
  }

  type Query {
    me(token: String!): User
    verifyToken(token: String!): VerifyPayload!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!, role: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    refreshToken(refreshToken: String!): RefreshPayload!
    logout(refreshToken: String!): Boolean!
  }
`;

module.exports = typeDefs;