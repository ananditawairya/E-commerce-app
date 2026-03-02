const mongoose = require('mongoose');

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const kafkaProducer = require('../kafka/kafkaProducer');
const SagaCoordinator = require('../../../shared/saga/SagaCoordinator');
const orderCreationSaga = require('../saga/orderCreationSaga');
const cartOperations = require('./orderService/cartOperations');
const orderReadOperations = require('./orderService/orderReadOperations');
const orderMutationOperations = require('./orderService/orderMutationOperations');

let sagaCoordinator;

/**
 * Initializes shared saga coordinator for order workflows.
 * @return {Promise<void>} No return value.
 */
async function initializeSagaCoordinator() {
  try {
    sagaCoordinator = new SagaCoordinator('order-service', mongoose);
    sagaCoordinator.registerSaga('ORDER_CREATION', orderCreationSaga);

    await sagaCoordinator.connect();
    console.log('✅ Saga coordinator connected');
  } catch (error) {
    console.error('❌ Saga coordinator initialization failed:', error.message);
    throw error;
  }
}

/**
 * Service orchestrator for order and cart domain operations.
 */
class OrderService {
  constructor() {
    this.deps = {
      Cart,
      Order,
      kafkaProducer,
      orderCreationSaga,
    };
  }

  /**
   * Returns buyer cart, creating empty cart if missing.
   * @param {string} userId Buyer user id.
   * @return {Promise<object>} Cart document.
   */
  async getCart(userId) {
    return cartOperations.getCart(this.deps, userId);
  }

  /**
   * Adds item to buyer cart.
   * @param {string} userId Buyer user id.
   * @param {object} input Item payload.
   * @return {Promise<object>} Updated cart.
   */
  async addToCart(userId, input) {
    return cartOperations.addToCart(this.deps, userId, input);
  }

  /**
   * Updates quantity for one cart item.
   * @param {string} userId Buyer user id.
   * @param {object} input Update payload.
   * @return {Promise<object>} Updated cart.
   */
  async updateCartItem(userId, input) {
    return cartOperations.updateCartItem(this.deps, userId, input);
  }

  /**
   * Removes one cart item.
   * @param {string} userId Buyer user id.
   * @param {object} input Remove payload.
   * @return {Promise<object>} Updated cart.
   */
  async removeFromCart(userId, input) {
    return cartOperations.removeFromCart(this.deps, userId, input);
  }

  /**
   * Clears buyer cart.
   * @param {string} userId Buyer user id.
   * @return {Promise<boolean>} True when cleared.
   */
  async clearCart(userId) {
    return cartOperations.clearCart(this.deps, userId);
  }

  /**
   * Creates one order per seller from buyer checkout payload.
   * @param {string} userId Buyer user id.
   * @param {{items: object[], totalAmount: number, shippingAddress: object}} input Order payload.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object[]>} Created orders.
   */
  async createOrder(userId, input, correlationId) {
    return orderMutationOperations.createOrder(
      {
        ...this.deps,
        sagaCoordinator,
      },
      userId,
      input,
      correlationId
    );
  }

  /**
   * Returns orders for buyer.
   * @param {string} buyerId Buyer user id.
   * @return {Promise<object[]>} Order list.
   */
  async getOrdersByBuyer(buyerId) {
    return orderReadOperations.getOrdersByBuyer(this.deps, buyerId);
  }

  /**
   * Returns orders for seller.
   * @param {string} sellerId Seller user id.
   * @return {Promise<object[]>} Order list.
   */
  async getOrdersBySeller(sellerId) {
    return orderReadOperations.getOrdersBySeller(this.deps, sellerId);
  }

  /**
   * Returns seller analytics by day range.
   * @param {string} sellerId Seller user id.
   * @param {number=} days Day range.
   * @return {Promise<object>} Analytics payload.
   */
  async getSellerAnalytics(sellerId, days = 30) {
    return orderReadOperations.getSellerAnalytics(this.deps, sellerId, days);
  }

  /**
   * Returns order by id.
   * @param {string} orderId Order id.
   * @return {Promise<object>} Order document.
   */
  async getOrderById(orderId) {
    return orderReadOperations.getOrderById(this.deps, orderId);
  }

  /**
   * Updates seller-owned order status.
   * @param {string} orderId Order id.
   * @param {string} sellerId Seller user id.
   * @param {string} status New status.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object>} Updated order.
   */
  async updateOrderStatus(orderId, sellerId, status, correlationId) {
    return orderMutationOperations.updateOrderStatus(
      this.deps,
      orderId,
      sellerId,
      status,
      correlationId
    );
  }

  /**
   * Cancels seller-owned order.
   * @param {string} orderId Order id.
   * @param {string} sellerId Seller user id.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object>} Cancelled order.
   */
  async cancelOrder(orderId, sellerId, correlationId) {
    return orderMutationOperations.cancelOrder(
      this.deps,
      orderId,
      sellerId,
      correlationId
    );
  }
}

module.exports = new OrderService();
module.exports.initializeSagaCoordinator = initializeSagaCoordinator;
