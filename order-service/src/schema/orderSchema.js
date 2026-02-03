// backend/order-service/src/schema/orderSchema.js

const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type CartItem {
    id: ID!
    productId: String!
    productName: String!
    variantId: String
    variantName: String
    quantity: Int!
    price: Float!
  }

  type Cart {
    id: ID!
    userId: String!
    items: [CartItem!]!
    totalAmount: Float!
  }

  type OrderItem {
    productId: String!
    productName: String!
    variantId: String
    variantName: String
    quantity: Int!
    price: Float!
    sellerId: String!
  }

  type ShippingAddress {
    street: String!
    city: String!
    state: String!
    zipCode: String!
    country: String!
  }

  type Order {
    id: ID!
    orderId: String!
    buyerId: String!
    items: [OrderItem!]!
    totalAmount: Float!
    status: String!
    shippingAddress: ShippingAddress
    paymentMethod: String!
    createdAt: String!
    updatedAt: String!
  }

  input CartItemInput {
    productId: String!
    variantId: String
    quantity: Int!
    price: Float!
  }

  input ShippingAddressInput {
    street: String!
    city: String!
    state: String!
    zipCode: String!
    country: String!
  }

  type Query {
    myCart: Cart
    myOrders: [Order!]!
    sellerOrders: [Order!]!
    order(id: ID!): Order
  }

  type Mutation {
    addToCart(productId: String!, productName: String!, variantId: String, variantName: String, quantity: Int!, price: Float!): Cart!
    updateCartItem(productId: String!, variantId: String, quantity: Int!): Cart!
    removeFromCart(productId: String!, variantId: String): Cart!
    clearCart: Boolean!
    checkout(shippingAddress: ShippingAddressInput!): Order!
    updateOrderStatus(orderId: ID!, status: String!): Order!
    cancelOrder(orderId: ID!): Order!
  }
`;

module.exports = typeDefs;