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

  // CHANGE: Group items by seller to create separate orders
  const itemsBySeller = items.reduce((acc, item) => {
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
      // CHANGE: If saga fails, update order status to cancelled
      order.status = 'cancelled';
      await order.save();

      console.error(`❌ Order creation saga failed: ${order.orderId}`, error.message);
      
      // CHANGE: Continue creating orders for other sellers even if one fails
      createdOrders.push(order);
    }
  }

  // CHANGE: Return array of orders instead of single order
  return createdOrders;
}

  // CHANGE: Execute saga steps sequentially
  async executeSagaSteps(saga, correlationId) {
    const definition = orderCreationSaga;

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      
      try {
        console.log(`🔄 Executing saga step: ${step.name}`);
        
        const stepData = await step.execute(saga.payload, correlationId);
        
        await sagaCoordinator.completeStep(saga.sagaId, step.name, stepData, correlationId);
        
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

  async getSellerAnalytics(sellerId, days = 30) {
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (safeDays - 1));

    const match = {
      'items.sellerId': sellerId,
      createdAt: { $gte: start },
    };

    const totalsAgg = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
        },
      },
    ]);

    const statusAgg = await Order.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const trendAgg = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totals = totalsAgg[0] || { totalRevenue: 0, totalOrders: 0 };
    const averageOrderValue = totals.totalOrders > 0
      ? totals.totalRevenue / totals.totalOrders
      : 0;

    const statusMap = statusAgg.map(s => ({ status: s._id, count: s.count }));

    const trendMap = new Map(trendAgg.map(t => [t._id, t]));
    const trend = [];
    for (let i = 0; i < safeDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const point = trendMap.get(key);
      trend.push({
        date: key,
        revenue: point ? point.revenue : 0,
        orders: point ? point.orders : 0,
      });
    }

    return {
      totalRevenue: totals.totalRevenue,
      totalOrders: totals.totalOrders,
      averageOrderValue,
      ordersByStatus: statusMap,
      trend,
    };
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

    order.status = 'cancelled';
    await order.save();

    await kafkaProducer.publishOrderCancelled(
      {
        orderId: order.orderId,
        buyerId: order.buyerId,
        items: order.items,
        totalAmount: order.totalAmount,
      },
      correlationId
    );

    return order;
  }
}

module.exports = new OrderService();
module.exports.initializeSagaCoordinator = initializeSagaCoordinator;
