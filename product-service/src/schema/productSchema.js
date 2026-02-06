// backend/product-service/src/schema/productSchema.js

const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Variant {
    id: ID!
    name: String!
    description: String
    images: [String!]
    priceModifier: Float!
    stock: Int!
    sku: String!
    effectiveDescription: String!
    effectiveImages: [String!]!
    effectivePrice: Float!
  }

  type Product {
    id: ID!
    sellerId: String!
    name: String!
    description: String!
    formattedDescription: String!
    category: String!
    basePrice: Float!
    images: [String!]!
    variants: [Variant!]!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  enum ProductSortBy {
    RELEVANCE
    NEWEST
    PRICE_LOW_TO_HIGH
    PRICE_HIGH_TO_LOW
    NAME_A_TO_Z
    NAME_Z_TO_A
  }

  input VariantInput {
    name: String!
    description: String
    images: [String!]
    priceModifier: Float = 0
    stock: Int!
    sku: String
  }

  input ProductInput {
    name: String!
    description: String!
    category: String!
    basePrice: Float!
    images: [String!] = []
    variants: [VariantInput!]!
  }

  input ProductUpdateInput {
    name: String
    description: String
    category: String
    basePrice: Float
    images: [String!]
    variants: [VariantInput!]
    isActive: Boolean
  }

  type Query {
    products(
      search: String
      category: String
      minPrice: Float
      maxPrice: Float
      inStockOnly: Boolean
      sortBy: ProductSortBy
      limit: Int
      offset: Int
    ): [Product!]!
    product(id: ID!): Product
    sellerProducts: [Product!]!
    categories: [String!]!
  }

  type Mutation {
    createProduct(input: ProductInput!): Product!
    updateProduct(id: ID!, input: ProductUpdateInput!): Product!
    deleteProduct(id: ID!): Boolean!
    deductStock(productId: ID!, variantId: ID!, quantity: Int!): Boolean!
  }
`;

module.exports = typeDefs;
