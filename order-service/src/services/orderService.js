// backend/order-service/src/services/orderService.js
// CHANGE: New service layer for order database operations

const Cart = require('../models/Cart');
const Order = require('../models/Order');

class OrderService {
  async getCart(userId) {
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
      await cart.save();
    }

    // CHANGE: Ensure toJSON is called to map _id to id
    return cart.toJSON();
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
    // CHANGE: Ensure toJSON is called to map _id to id
    return cart.toJSON();
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
    // CHANGE: Ensure toJSON is called to map _id to id
    return cart.toJSON();
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
    // CHANGE: Ensure toJSON is called to map _id to id
    return cart.toJSON();
  }

  async clearCart(userId) {
    await Cart.findOneAndUpdate(
      { userId },
      { items: [] }
    );
    return true;
  }

  async createOrder(userId, { items, totalAmount, shippingAddress }) {
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

  async updateOrderStatus(orderId, sellerId, status) {
    const order = await Order.findById(orderId);

    if (!order) {
      const error = new Error('Order not found');
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    // Check if seller has items in this order
    const hasItems = order.items.some(item => item.sellerId === sellerId);
    if (!hasItems) {
      const error = new Error('Unauthorized to update this order');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    order.status = status;
    await order.save();

    return order;
  }
}

module.exports = new OrderService();