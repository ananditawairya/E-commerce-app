// backend/order-service/src/kafka/kafkaProducer.js
// CHANGE: Use shared Kafka producer with service-specific event handlers

const KafkaProducer = require('../../../shared/kafka/KafkaProducer');
const { 
  TOPICS, 
  createOrderCreatedEvent, 
  createOrderStatusUpdatedEvent,
  createOrderCancelledEvent
} = require('../../../shared/kafka/events/OrderEvents');

class OrderServiceProducer {
  constructor() {
    this.producer = new KafkaProducer('order-service');
  }

  async connect() {
    return this.producer.connect();
  }

  async disconnect() {
    return this.producer.disconnect();
  }

  async publishOrderCreated(order, correlationId) {
    const event = createOrderCreatedEvent(order);
    const message = this.producer.buildMessage(order.orderId, event, correlationId);

    // CHANGE: Critical event - stock deduction depends on this
    return this.producer.publish(TOPICS.ORDER_CREATED, message, {
      critical: true,
      correlationId,
      retries: 3,
    });
  }

  async publishOrderStatusUpdated(orderId, status, correlationId) {
    const event = createOrderStatusUpdatedEvent(orderId, status);
    const message = this.producer.buildMessage(orderId, event, correlationId);

    // CHANGE: Non-critical event - status update succeeds even if Kafka fails
    return this.producer.publish(TOPICS.ORDER_STATUS_UPDATED, message, {
      critical: false,
      correlationId,
    });
  }

  // CHANGE: Add order cancelled event publisher
  async publishOrderCancelled(order, correlationId) {
    const event = createOrderCancelledEvent(order);
    const message = this.producer.buildMessage(order.orderId, event, correlationId);

    // CHANGE: Critical event - stock restoration depends on this
    return this.producer.publish(TOPICS.ORDER_CANCELLED, message, {
      critical: true,
      correlationId,
      retries: 3,
    });
  }
}

module.exports = new OrderServiceProducer();