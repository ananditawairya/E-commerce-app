// backend/product-service/src/kafka/kafkaProducer.js
// CHANGE: Add product event publishing capabilities

const KafkaProducer = require('../../../shared/kafka/KafkaProducer');
const { TOPICS, createStockDeductedEvent } = require('../../../shared/kafka/events/ProductEvents');

class ProductServiceProducer {
  constructor() {
    this.producer = new KafkaProducer('product-service');
  }

  async connect() {
    return this.producer.connect();
  }

  async disconnect() {
    return this.producer.disconnect();
  }

  // CHANGE: Publish ProductCreated event
  async publishProductCreated(product, correlationId) {
    const event = {
      eventType: 'ProductCreated',
      payload: {
        productId: product.id,
        sellerId: product.sellerId,
        name: product.name,
        category: product.category,
        basePrice: product.basePrice,
        variants: product.variants.map(v => ({
          variantId: v.id,
          name: v.name,
          stock: v.stock,
          sku: v.sku,
        })),
        createdAt: product.createdAt,
      },
    };

    const message = this.producer.buildMessage(product.id, event, correlationId);

    // CHANGE: Non-critical event - product creation succeeds even if Kafka fails
    return this.producer.publish(TOPICS.PRODUCT_CREATED, message, {
      critical: false,
      correlationId,
    });
  }

  // CHANGE: Publish ProductUpdated event
  async publishProductUpdated(product, correlationId) {
    const event = {
      eventType: 'ProductUpdated',
      payload: {
        productId: product.id,
        sellerId: product.sellerId,
        name: product.name,
        category: product.category,
        basePrice: product.basePrice,
        variants: product.variants.map(v => ({
          variantId: v.id,
          name: v.name,
          stock: v.stock,
          sku: v.sku,
        })),
        updatedAt: product.updatedAt,
      },
    };

    const message = this.producer.buildMessage(product.id, event, correlationId);

    // CHANGE: Non-critical event
    return this.producer.publish(TOPICS.PRODUCT_UPDATED, message, {
      critical: false,
      correlationId,
    });
  }

  // CHANGE: Publish StockDeducted event
  async publishStockDeducted(productId, variantId, quantity, orderId, correlationId) {
    const event = createStockDeductedEvent(productId, variantId, quantity, orderId);
    const message = this.producer.buildMessage(productId, event, correlationId);

    // CHANGE: Non-critical event - stock deduction already succeeded in DB
    return this.producer.publish(TOPICS.STOCK_DEDUCTED, message, {
      critical: false,
      correlationId,
    });
  }

  // CHANGE: Add stock restored event publisher
  async publishStockRestored(productId, variantId, quantity, orderId, correlationId) {
    const event = {
      eventType: 'StockRestored',
      payload: {
        productId,
        variantId,
        quantity,
        orderId,
        restoredAt: new Date().toISOString(),
      },
    };

    const message = this.producer.buildMessage(productId, event, correlationId);

    // CHANGE: Non-critical event - stock restoration already succeeded in DB
    return this.producer.publish('product.stock.restored', message, {
      critical: false,
      correlationId,
    });
  }
}

module.exports = new ProductServiceProducer();