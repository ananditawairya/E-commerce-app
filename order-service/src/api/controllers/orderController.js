// backend/order-service/src/api/controllers/orderController.js
// CHANGE: Pass correlation ID to service layer for Kafka events

const orderService = require('../../services/orderService');

class OrderController {
  async getCart(req, res, next) {
    try {
      const { userId } = req.params;
      const cart = await orderService.getCart(userId);
      res.json(cart);
    } catch (error) {
      next(error);
    }
  }

  async addToCart(req, res, next) {
    try {
      const { userId } = req.params;
      const { productId, productName, variantId, variantName, quantity, price } = req.body;

      req.log.info({ userId, productId, variantId, quantity }, 'Adding item to cart');

       const cart = await orderService.addToCart(userId, {
        productId,
        productName,
        variantId,
        variantName,
        quantity,
        price,
      });

      req.log.info({ userId, productId, cartItemCount: cart.items.length }, 'Item added to cart');

      res.json(cart);
    } catch (error) {
      next(error);
    }
  }

  async updateCartItem(req, res, next) {
    try {
      const { userId } = req.params;
      const { productId, variantId, quantity } = req.body;

      req.log.info({ userId, productId, variantId, quantity }, 'Updating cart item');

      const cart = await orderService.updateCartItem(userId, {
        productId,
        variantId,
        quantity,
      });

      req.log.info({ userId, productId, cartItemCount: cart.items.length }, 'Cart item updated');

      res.json(cart);
    } catch (error) {
      next(error);
    }
  }

  async removeFromCart(req, res, next) {
    try {
      const { userId } = req.params;
      const { productId, variantId } = req.body;

      req.log.info({ userId, productId, variantId }, 'Removing item from cart');

      const cart = await orderService.removeFromCart(userId, {
        productId,
        variantId,
      });

      req.log.info({ userId, productId, cartItemCount: cart.items.length }, 'Item removed from cart');

      res.json(cart);
    } catch (error) {
      next(error);
    }
  }

  async clearCart(req, res, next) {
    try {
      const { userId } = req.params;

      req.log.info({ userId }, 'Clearing cart');

      await orderService.clearCart(userId);

      req.log.info({ userId }, 'Cart cleared');

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

 async createOrder(req, res, next) {
  try {
    const { userId } = req.params;
    const { items, totalAmount, shippingAddress } = req.body;

    req.log.info({
      userId,
      itemCount: items.length,
      totalAmount,
    }, 'Creating order');

    // CHANGE: Pass correlation ID to service for Kafka event (returns array)
    const orders = await orderService.createOrder(
      userId,
      { items, totalAmount, shippingAddress },
      req.correlationId
    );

    req.log.info({
      userId,
      orderCount: orders.length,
      orderIds: orders.map(o => o.orderId),
      totalAmount,
    }, 'Orders created successfully');

    // CHANGE: Return array of orders
    res.status(201).json(orders);
  } catch (error) {
    next(error);
  }
}

  async getOrdersByBuyer(req, res, next) {
    try {
      const { buyerId } = req.params;

      req.log.info({ buyerId }, 'Fetching buyer orders');

      const orders = await orderService.getOrdersByBuyer(buyerId);
      res.json(orders);
    } catch (error) {
      next(error);
    }
  }

  async getOrdersBySeller(req, res, next) {
    try {
      const { sellerId } = req.params;

      req.log.info({ sellerId }, 'Fetching seller orders');

      const orders = await orderService.getOrdersBySeller(sellerId);
      res.json(orders);
    } catch (error) {
      next(error);
    }
  }

  async getSellerAnalytics(req, res, next) {
    try {
      const { sellerId } = req.params;
      const { days } = req.query;

      req.log.info({ sellerId, days }, 'Fetching seller analytics');

      const analytics = await orderService.getSellerAnalytics(sellerId, days);
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  }

  async getOrder(req, res, next) {
    try {
      const { id } = req.params;
      const order = await orderService.getOrderById(id);
      res.json(order);
    } catch (error) {
      next(error);
    }
  }

  async updateOrderStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { sellerId, status } = req.body;

      req.log.info({ orderId: id, sellerId, status }, 'Updating order status');

      // CHANGE: Pass correlation ID to service for Kafka event
      const order = await orderService.updateOrderStatus(id, sellerId, status, req.correlationId);

      req.log.info({ orderId: id, sellerId, status }, 'Order status updated');

      res.json(order);
    } catch (error) {
      next(error);
    }
  }

  // CHANGE: Add cancel order controller method
  async cancelOrder(req, res, next) {
    try {
      const { id } = req.params;
      const { sellerId } = req.body;

      req.log.info({ orderId: id, sellerId }, 'Cancelling order');

      const order = await orderService.cancelOrder(id, sellerId, req.correlationId);

      req.log.info({ orderId: id, sellerId }, 'Order cancelled successfully');

      res.json(order);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OrderController();
