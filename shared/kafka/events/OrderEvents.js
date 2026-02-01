// backend/shared/kafka/events/OrderEvents.js
// CHANGE: Centralized order event schemas

const TOPICS = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_UPDATED: 'order.status.updated',
  ORDER_CANCELLED: 'order.cancelled',
};

const createOrderCreatedEvent = (order) => ({
  eventType: 'OrderCreated',
  payload: {
    orderId: order.orderId,
    buyerId: order.buyerId,
    items: order.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: item.price,
      sellerId: item.sellerId,
    })),
    totalAmount: order.totalAmount,
    status: order.status,
    createdAt: order.createdAt,
  },
});

const createOrderStatusUpdatedEvent = (orderId, status) => ({
  eventType: 'OrderStatusUpdated',
  payload: {
    orderId,
    status,
    updatedAt: new Date().toISOString(),
  },
});

// CHANGE: Add order cancelled event
const createOrderCancelledEvent = (order) => ({
  eventType: 'OrderCancelled',
  payload: {
    orderId: order.orderId,
    buyerId: order.buyerId,
    items: order.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: item.price,
      sellerId: item.sellerId,
    })),
    totalAmount: order.totalAmount,
    cancelledAt: new Date().toISOString(),
  },
});

module.exports = {
  TOPICS,
  createOrderCreatedEvent,
  createOrderStatusUpdatedEvent,
  createOrderCancelledEvent,
};