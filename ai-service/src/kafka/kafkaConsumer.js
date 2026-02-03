// backend/ai-service/src/kafka/kafkaConsumer.js
// CHANGE: Kafka consumer for real-time product indexing

import KafkaConsumer from '../../../shared/kafka/KafkaConsumer.js';
import productIndexer from '../services/productIndexer.js';

class AIServiceConsumer {
  constructor() {
    this.consumer = new KafkaConsumer('ai-service', 'ai-service-group');
    this._registerHandlers();
  }

  _registerHandlers() {
    // CHANGE: Register handler for ProductCreated events
    this.consumer.registerHandler('product.created', async (event, context) => {
      await this._handleProductCreated(event, context);
    });

    // CHANGE: Register handler for ProductUpdated events
    this.consumer.registerHandler('product.updated', async (event, context) => {
      await this._handleProductUpdated(event, context);
    });
  }

  async start() {
    await this.consumer.subscribe(['product.created', 'product.updated']);
    
    await this.consumer.start({
      enableDLQ: true,
      maxRetries: 3,
      retryDelay: 1000,
    });
  }

  async disconnect() {
    return this.consumer.disconnect();
  }

  async _handleProductCreated(event, context) {
    const { productId, name, description, category, basePrice, images } = event.payload;
    const { correlationId } = context;

    console.log(`📦 Processing ProductCreated: ${productId}`);

    try {
      await productIndexer.indexSingleProduct(productId, {
        id: productId,
        name,
        description,
        category,
        basePrice,
        images,
      });

      console.log(`✅ Product indexed: ${name} (${correlationId})`);
    } catch (error) {
      console.error(`❌ Failed to index product ${productId}:`, error.message);
      throw error;
    }
  }

  async _handleProductUpdated(event, context) {
    const { productId, name, description, category, basePrice, images } = event.payload;
    const { correlationId } = context;

    console.log(`🔄 Processing ProductUpdated: ${productId}`);

    try {
      await productIndexer.indexSingleProduct(productId, {
        id: productId,
        name,
        description,
        category,
        basePrice,
        images,
      });

      console.log(`✅ Product re-indexed: ${name} (${correlationId})`);
    } catch (error) {
      console.error(`❌ Failed to re-index product ${productId}:`, error.message);
      throw error;
    }
  }
}

export default new AIServiceConsumer();