// backend/auth-service/src/schema/authSchema.js

const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Address {
    id: ID!
    street: String!
    city: String!
    state: String!
    zipCode: String!
    country: String!
    isDefault: Boolean!
  }

  type UserPreferences {
    language: String!
    currency: String!
    timezone: String!
    marketingEmails: Boolean!
    orderUpdates: Boolean!
  }

  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    phoneNumber: String
    avatarUrl: String
    bio: String
    dateOfBirth: String
    emailVerified: Boolean!
    preferences: UserPreferences!
    addresses: [Address!]
    lastLoginAt: String
    createdAt: String!
    updatedAt: String
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

  input AddressInput {
    street: String!
    city: String!
    state: String!
    zipCode: String!
    country: String!
    isDefault: Boolean
  }

  input UserPreferencesInput {
    language: String
    currency: String
    timezone: String
    marketingEmails: Boolean
    orderUpdates: Boolean
  }

  input UpdateProfileInput {
    name: String
    phoneNumber: String
    avatarUrl: String
    bio: String
    dateOfBirth: String
    preferences: UserPreferencesInput
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
    
    addAddress(address: AddressInput!): Address!
    updateAddress(id: ID!, address: AddressInput!): Address!
    removeAddress(id: ID!): Boolean!
    setDefaultAddress(id: ID!): Boolean!
    updateProfile(profile: UpdateProfileInput!): User!
  }
`;

module.exports = typeDefs;
