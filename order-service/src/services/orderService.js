// backend/order-service/src/services/orderService.js
// CHANGE: Integrated Kafka event publishing

const Cart = require('../models/Cart');
const Order = require('../models/Order');
// CHANGE: Import Kafka producer
const kafkaProducer = require('../kafka/kafkaProducer');

class OrderService {
  async getCart(userId) {
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
      await cart.save();
    }

    return cart;
  }

  async addToCart(userId, { productId, variantId, quantity, price }) {
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
    } else {
      cart.items.push({ productId, variantId, quantity, price });
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
    const order = new Order({
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      buyerId: userId,
      items,
      totalAmount,
      shippingAddress,
      status: 'pending',
      paymentMethod: 'mock',
    });

    await order.save();

    // CHANGE: Publish OrderCreated event to Kafka
    await kafkaProducer.publishOrderCreated(
      {
        orderId: order.orderId,
        buyerId: order.buyerId,
        items: order.items,
        totalAmount: order.totalAmount,
        status: order.status,
        createdAt: order.createdAt,
      },
      correlationId
    );

    return order;
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

    // CHANGE: Publish OrderStatusUpdated event to Kafka (async, non-blocking)
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

    // CHANGE: Publish OrderCancelled event to Kafka for stock restoration
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