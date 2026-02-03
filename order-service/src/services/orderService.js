// backend/order-service/src/services/orderService.js
// CHANGE: Pass mongoose instance to saga coordinator

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const kafkaProducer = require('../kafka/kafkaProducer');
const mongoose = require('mongoose');
// CHANGE: Import Saga coordinator
const SagaCoordinator = require('../../../shared/saga/SagaCoordinator');
const orderCreationSaga = require('../saga/orderCreationSaga');

// CHANGE: Initialize saga coordinator with mongoose instance
let sagaCoordinator;

// CHANGE: Connect saga coordinator on service startup
const initializeSagaCoordinator = async () => {
  try {
    // CHANGE: Pass mongoose instance to coordinator
    sagaCoordinator = new SagaCoordinator('order-service', mongoose);
    
    // CHANGE: Register order creation saga
    sagaCoordinator.registerSaga('ORDER_CREATION', orderCreationSaga);
    
    await sagaCoordinator.connect();
    console.log('✅ Saga coordinator connected');
  } catch (error) {
    console.error('❌ Saga coordinator initialization failed:', error.message);
    throw error;
  }
};

class OrderService {
  async getCart(userId) {
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
      await cart.save();
    }

    return cart;
  }

  async addToCart(userId, { productId, productName, variantId, variantName, quantity, price }) {
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      item => item.productId === productId &&
        (item.variantId || null) === (variantId || null)
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += quantity;
      cart.items[existingItemIndex].productName = productName;
      if (variantName) {
        cart.items[existingItemIndex].variantName = variantName;
      }
    } else {
      cart.items.push({ 
        productId, 
        productName, 
        variantId, 
        variantName, 
        quantity, 
        price 
      });
    }

    await cart.save();
    return cart;
  }

  async updateCartItem(userId, { productId, variantId, quantity }) {
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      const error = new Error('Cart not found');
      error.code = 'CART_NOT_FOUND';
      throw error;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId === productId &&
        (item.variantId || null) === (variantId || null)
    );

    if (itemIndex === -1) {
      const error = new Error('Item not found in cart');
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      cart.items[itemIndex].quantity = quantity;
    }

    await cart.save();
    return cart;
  }

  async removeFromCart(userId, { productId, variantId }) {
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      const error = new Error('Cart not found');
      error.code = 'CART_NOT_FOUND';
      throw error;
    }

    cart.items = cart.items.filter(
      item => !(item.productId === productId &&
        (item.variantId || null) === (variantId || null))
    );

    await cart.save();
    return cart;
  }

  async clearCart(userId) {
    await Cart.findOneAndUpdate(
      { userId },
      { items: [] }
    );
    return true;
  }

async createOrder(userId, { items, totalAmount, shippingAddress }, correlationId) {
  // CHANGE: Ensure saga coordinator is initialized
  if (!sagaCoordinator) {
    throw new Error('Saga coordinator not initialized');
  }

  // CHANGE: Atomically get and clear cart to prevent race conditions
  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) {
    throw new Error('Cart is empty or not found');
  }

  // CHANGE: Clear cart atomically using findOneAndUpdate with empty items
  const clearedCart = await Cart.findOneAndUpdate(
    { userId, 'items.0': { $exists: true } }, // Only update if cart has items
    { items: [] },
    { new: false } // Return original document before update
  );

  // CHANGE: If cart was already empty (race condition), throw error
  if (!clearedCart || clearedCart.items.length === 0) {
    throw new Error('Cart is empty or already processed');
  }

  // CHANGE: Use original cart items for order creation
  const cartItems = clearedCart.items;

  // CHANGE: Map cart items to order items with seller information
  const actualItems = cartItems.map(cartItem => {
    const matchingItem = items.find(i => i.productId === cartItem.productId);
    return {
      productId: cartItem.productId,
      productName: cartItem.productName,
      variantId: cartItem.variantId,
      variantName: cartItem.variantName,
      quantity: cartItem.quantity,
      price: cartItem.price,
      sellerId: matchingItem?.sellerId || 'unknown'
    };
  });

  // CHANGE: Group items by seller to create separate orders
  const itemsBySeller = actualItems.reduce((acc, item) => {
    if (!acc[item.sellerId]) {
      acc[item.sellerId] = [];
    }
    acc[item.sellerId].push(item);
    return acc;
  }, {});

  const sellerIds = Object.keys(itemsBySeller);
  
  // CHANGE: Create separate order for each seller
  const createdOrders = [];
  
  for (const sellerId of sellerIds) {
    const sellerItems = itemsBySeller[sellerId];
    const sellerTotal = sellerItems.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );

    // CHANGE: Create individual order per seller
    const order = new Order({
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      buyerId: userId,
      items: sellerItems,
      totalAmount: sellerTotal,
      shippingAddress,
      status: 'pending',
      paymentMethod: 'mock',
    });

    await order.save();

    // CHANGE: Start saga for each seller's order
    try {
      const saga = await sagaCoordinator.startSaga(
        'ORDER_CREATION',
        {
          orderId: order.orderId,
          buyerId: order.buyerId,
          items: order.items,
          totalAmount: order.totalAmount,
          shippingAddress: order.shippingAddress,
        },
        `${correlationId}-${sellerId}`
      );

      // CHANGE: Execute saga steps
      await this.executeSagaSteps(saga, `${correlationId}-${sellerId}`);

      // CHANGE: Update order status to confirmed if saga succeeds
      order.status = 'confirmed';
      await order.save();

      await kafkaProducer.publishOrderCreated(
        {
          orderId: order.orderId,
          buyerId: order.buyerId,
          items: order.items,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt,
        },
        `${correlationId}-${sellerId}`
      );

      createdOrders.push(order);

      console.log(`✅ Order created successfully via saga: ${order.orderId} for seller: ${sellerId}`);
    } catch (error) {
      // CHANGE: If saga fails, update order status to cancelled and restore cart
      order.status = 'cancelled';
      await order.save();

      // CHANGE: Restore cart items for failed order only if no other orders succeeded
      if (createdOrders.length === 0) {
        await Cart.findOneAndUpdate(
          { userId },
          { $push: { items: { $each: sellerItems } } },
          { upsert: true }
        );
      }

      console.error(`❌ Order creation saga failed: ${order.orderId}`, error.message);
      
      // CHANGE: Continue creating orders for other sellers even if one fails
      createdOrders.push(order);
    }
  }

  // CHANGE: If no orders were created successfully, restore the entire cart
  if (createdOrders.length === 0 || createdOrders.every(o => o.status === 'cancelled')) {
    await Cart.findOneAndUpdate(
      { userId },
      { items: cartItems },
      { upsert: true }
    );
    throw new Error('Order creation failed for all items');
  }

  // CHANGE: Return array of orders instead of single order
  return createdOrders;
}

// CHANGE: Update executeSagaSteps to pass saga data to steps
async executeSagaSteps(saga, correlationId) {
  const definition = orderCreationSaga;

  for (let i = 0; i < definition.steps.length; i++) {
    const step = definition.steps[i];
    
    try {
      console.log(`🔄 Executing saga step: ${step.name}`);
      
      // CHANGE: Pass saga steps data to step execution for access to previous step data
      const payloadWithSteps = {
        ...saga.payload,
        sagaSteps: saga.steps
      };
      
      const stepData = await step.execute(payloadWithSteps, correlationId);
      
      await sagaCoordinator.completeStep(saga.sagaId, step.name, stepData, correlationId);
      
      // CHANGE: Refresh saga data after each step completion
      const updatedSaga = await sagaCoordinator.getSagaStatus(saga.sagaId);
      saga.steps = updatedSaga.steps;
      
      console.log(`✅ Saga step completed: ${step.name}`);
    } catch (error) {
      console.error(`❌ Saga step failed: ${step.name}`, error.message);
      
      await sagaCoordinator.failStep(saga.sagaId, step.name, error, correlationId);
      
      throw error;
    }
  }
}

  async getOrdersByBuyer(buyerId) {
    const orders = await Order.find({ buyerId })
      .sort({ createdAt: -1 });
    return orders;
  }

  async getOrdersBySeller(sellerId) {
    const orders = await Order.find({ 'items.sellerId': sellerId })
      .sort({ createdAt: -1 });
    return orders;
  }

  async getOrderById(orderId) {
    const order = await Order.findById(orderId);
    if (!order) {
      const error = new Error('Order not found');
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }
    return order;
  }

  async updateOrderStatus(orderId, sellerId, status, correlationId) {
    const order = await Order.findById(orderId);

    if (!order) {
      const error = new Error('Order not found');
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    const hasItems = order.items.some(item => item.sellerId === sellerId);
    if (!hasItems) {
      const error = new Error('Unauthorized to update this order');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    order.status = status;
    await order.save();

    setImmediate(async () => {
      try {
        await kafkaProducer.publishOrderStatusUpdated(order.orderId, status, correlationId);
      } catch (error) {
        console.error('Failed to publish order status update event:', error);
      }
    });

    return order;
  }

  async cancelOrder(orderId, sellerId, correlationId) {
  const order = await Order.findById(orderId);

  if (!order) {
    const error = new Error('Order not found');
    error.code = 'ORDER_NOT_FOUND';
    throw error;
  }

  const hasItems = order.items.some(item => item.sellerId === sellerId);
  if (!hasItems) {
    const error = new Error('Unauthorized to cancel this order');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (order.status === 'cancelled' || order.status === 'delivered') {
    const error = new Error('Order cannot be cancelled');
    error.code = 'CANNOT_CANCEL_ORDER';
    throw error;
  }

  // CHANGE: Update order status first
  order.status = 'cancelled';
  await order.save();

  // CHANGE: Publish order cancelled event with critical flag to ensure stock restoration
  try {
    await kafkaProducer.publishOrderCancelled(
      {
        orderId: order.orderId,
        buyerId: order.buyerId,
        items: order.items,
        totalAmount: order.totalAmount,
      },
      correlationId
    );
    console.log(`✅ Published OrderCancelled event for order: ${order.orderId}`);
  } catch (error) {
    console.error(`❌ Failed to publish OrderCancelled event for order: ${order.orderId}`, error);
    // CHANGE: Don't throw error here - order is already cancelled, but log the issue
    console.error('⚠️ Stock may not be restored automatically. Manual intervention may be required.');
  }

  return order;
}
}

module.exports = new OrderService();
module.exports.initializeSagaCoordinator = initializeSagaCoordinator;