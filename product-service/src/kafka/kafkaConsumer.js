// backend/product-service/src/kafka/kafkaConsumer.js
// CHANGE: Use shared Kafka consumer with service-specific handlers

const KafkaConsumer = require('../../../shared/kafka/KafkaConsumer');
const { TOPICS } = require('../../../shared/kafka/events/OrderEvents');
const productService = require('../services/productService');

class ProductServiceConsumer {
  constructor() {
    this.consumer = new KafkaConsumer('product-service', 'product-service-group');
    this._registerHandlers();
  }

  _registerHandlers() {
    // CHANGE: Register handler for OrderCreated events
    this.consumer.registerHandler(TOPICS.ORDER_CREATED, async (event, context) => {
      await this._handleOrderCreated(event, context);
    });

    // CHANGE: Register handler for OrderCancelled events to restore stock
    this.consumer.registerHandler(TOPICS.ORDER_CANCELLED, async (event, context) => {
      await this._handleOrderCancelled(event, context);
    });
  }

  async start() {
    // CHANGE: Subscribe to both ORDER_CREATED and ORDER_CANCELLED topics
    await this.consumer.subscribe([TOPICS.ORDER_CREATED, TOPICS.ORDER_CANCELLED]);
    
    // CHANGE: Enable DLQ for failed stock operations
    await this.consumer.start({
      enableDLQ: true,
      maxRetries: 3,
      retryDelay: 1000,
    });
  }

  async disconnect() {
    return this.consumer.disconnect();
  }

  async _handleOrderCreated(event, context) {
    const { orderId, items } = event.payload;
    const { correlationId } = context;

    console.log(`🛒 Processing OrderCreated: ${orderId} (${items.length} items)`);

    // CHANGE: Process items sequentially to maintain stock consistency
    for (const item of items) {
      await productService.deductStock(
        item.productId,
        item.variantId,
        item.quantity,
        orderId
      );

      console.log(
        `✅ Stock deducted: ${item.productId} ` +
        `(variant: ${item.variantId}, qty: ${item.quantity})`
      );
    }

    console.log(`✅ Completed processing OrderCreated: ${orderId}`);
  }

  // CHANGE: Add handler for order cancellation to restore stock
  async _handleOrderCancelled(event, context) {
    const { orderId, items } = event.payload;
    const { correlationId } = context;

    console.log(`❌ Processing OrderCancelled: ${orderId} (${items.length} items) - Restoring stock`);

    // CHANGE: Process items sequentially to restore stock
    for (const item of items) {
      await productService.restoreStock(
        item.productId,
        item.variantId,
        item.quantity,
        orderId,
        correlationId
      );

      console.log(
        `🔄 Stock restored: ${item.productId} ` +
        `(variant: ${item.variantId}, qty: ${item.quantity})`
      );
    }

    console.log(`✅ Completed stock restoration for cancelled order: ${orderId}`);
  }
}

module.exports = new ProductServiceConsumer();