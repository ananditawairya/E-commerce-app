// backend/shared/kafka/KafkaConsumer.js
// CHANGE: Generic consumer with dead letter queue support

const KafkaClient = require('./KafkaClient');

class KafkaConsumer {
  constructor(clientId, groupId) {
    this.client = new KafkaClient(clientId);
    this.groupId = groupId;
    this.consumer = this.client.createConsumer(groupId);
    this.isConnected = false;
    this.handlers = new Map(); // topic -> handler function
    this.dlqProducer = null; // For failed messages
  }

  async connect() {
    if (this.isConnected) return;

    await this.consumer.connect();
    this.isConnected = true;
    console.log(`✅ Kafka consumer connected - ${this.client.clientId} (${this.groupId})`);
  }

  async disconnect() {
    if (!this.isConnected) return;

    await this.consumer.disconnect();
    if (this.dlqProducer) {
      await this.dlqProducer.disconnect();
    }
    this.isConnected = false;
    console.log(`🔌 Kafka consumer disconnected - ${this.client.clientId}`);
  }

  // CHANGE: Register handler for specific topic
  registerHandler(topic, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.handlers.set(topic, handler);
  }

  // CHANGE: Subscribe to topics with registered handlers
  async subscribe(topics, options = {}) {
    await this.connect();

    const topicsArray = Array.isArray(topics) ? topics : [topics];
    
    await this.consumer.subscribe({
      topics: topicsArray,
      fromBeginning: options.fromBeginning || true,
    });

    console.log(`📥 Subscribed to topics: ${topicsArray.join(', ')}`);
  }

  // CHANGE: Start consuming with error handling and DLQ
  async start(options = {}) {
    const { 
      enableDLQ = false,
      maxRetries = 3,
      retryDelay = 1000,
    } = options;

    if (enableDLQ) {
      await this._initializeDLQ();
    }

    await this.consumer.run({
      // CHANGE: Process messages in parallel (up to 5)
      partitionsConsumedConcurrently: 5,
      
      eachMessage: async ({ topic, partition, message }) => {
        const correlationId = message.headers['correlation-id']?.toString() || 'unknown';
        const eventType = message.headers['event-type']?.toString() || 'unknown';

        let attempt = 0;
        let lastError;

        while (attempt <= maxRetries) {
          try {
            const event = JSON.parse(message.value.toString());
            
            console.log(`📨 Processing ${eventType} from ${topic} (${correlationId})`);

            const handler = this.handlers.get(topic);
            if (!handler) {
              console.warn(`⚠️ No handler registered for topic: ${topic}`);
              return;
            }

            await handler(event, { topic, partition, correlationId });
            
            console.log(`✅ Processed ${eventType} (${correlationId})`);
            return; // Success

          } catch (error) {
            lastError = error;
            attempt++;
            
            console.error(
              `❌ Error processing message (attempt ${attempt}/${maxRetries + 1}):`,
              error.message
            );

            if (attempt <= maxRetries) {
              // CHANGE: Exponential backoff
              const backoff = retryDelay * Math.pow(2, attempt - 1);
              await new Promise(resolve => setTimeout(resolve, backoff));
            }
          }
        }

        // CHANGE: Send to DLQ after all retries exhausted
        if (enableDLQ && this.dlqProducer) {
          await this._sendToDLQ(topic, message, lastError, correlationId);
        } else {
          console.error(`💀 Message processing failed permanently (${correlationId})`);
        }
      },
    });

    console.log('🎧 Kafka consumer is listening for events...');
  }

  async _initializeDLQ() {
    const KafkaProducer = require('./KafkaProducer');
    this.dlqProducer = new KafkaProducer(`${this.client.clientId}-dlq`);
    await this.dlqProducer.connect();
  }

  async _sendToDLQ(originalTopic, message, error, correlationId) {
    try {
      const dlqTopic = `${originalTopic}.dlq`;
      
      await this.dlqProducer.publish(
        dlqTopic,
        {
          key: message.key?.toString(),
          value: message.value.toString(),
          headers: {
            ...message.headers,
            'original-topic': originalTopic,
            'error-message': error.message,
            'failed-at': new Date().toISOString(),
          },
        },
        { critical: false, correlationId }
      );

      console.log(`📮 Sent to DLQ: ${dlqTopic} (${correlationId})`);
    } catch (dlqError) {
      console.error('❌ Failed to send to DLQ:', dlqError.message);
    }
  }
}

module.exports = KafkaConsumer;