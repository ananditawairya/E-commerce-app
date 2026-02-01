// backend/shared/kafka/KafkaProducer.js
// CHANGE: Generic producer with circuit breaker and retry logic

const KafkaClient = require('./KafkaClient');

class KafkaProducer {
  constructor(clientId) {
    this.client = new KafkaClient(clientId);
    this.producer = this.client.createProducer();
    this.isConnected = false;
    
    // CHANGE: Circuit breaker to prevent cascading failures
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      timeout: 60000,
      state: 'CLOSED',
      nextAttempt: null,
    };
  }

  async connect() {
    if (this.isConnected) return;

    // CHANGE: Check circuit breaker state
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() < this.circuitBreaker.nextAttempt) {
        throw new Error('Circuit breaker is OPEN - Kafka unavailable');
      }
      this.circuitBreaker.state = 'HALF_OPEN';
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      
      // CHANGE: Reset circuit breaker on successful connection
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.state = 'CLOSED';
      
      console.log(`✅ Kafka producer connected - ${this.client.clientId}`);
    } catch (error) {
      this._handleConnectionFailure(error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) return;

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      console.log(`🔌 Kafka producer disconnected - ${this.client.clientId}`);
    } catch (error) {
      console.error('Error disconnecting producer:', error.message);
    }
  }

  // CHANGE: Generic publish with configurable retry and criticality
  async publish(topic, messages, options = {}) {
    const { 
      critical = false, 
      correlationId = 'unknown',
      retries = critical ? 3 : 0,
    } = options;

    if (this.circuitBreaker.state === 'OPEN') {
      const error = new Error('Circuit breaker is OPEN - Kafka unavailable');
      if (critical) throw error;
      console.warn(error.message);
      return false;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.connect();

        const result = await this.producer.send({
          topic,
          messages: Array.isArray(messages) ? messages : [messages],
          timeout: 10000,
        });

        console.log(`📤 Published to ${topic}: ${messages.length || 1} message(s) (${correlationId})`);
        return result;

      } catch (error) {
        lastError = error;
        console.error(`❌ Publish attempt ${attempt + 1} failed:`, error.message);

        if (attempt < retries) {
          // CHANGE: Exponential backoff with jitter
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          const jitter = Math.random() * 0.3 * backoff;
          await new Promise(resolve => setTimeout(resolve, backoff + jitter));
        }
      }
    }

    this._handleConnectionFailure(lastError);

    if (critical) {
      throw lastError;
    }

    return false;
  }

  // CHANGE: Helper to build standardized event messages
  buildMessage(key, event, correlationId) {
    return {
      key: String(key),
      value: JSON.stringify({
        eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        correlationId,
        ...event,
      }),
      headers: {
        'correlation-id': correlationId,
        'event-type': event.eventType,
        'service': this.client.clientId,
      },
    };
  }

  _handleConnectionFailure(error) {
    this.circuitBreaker.failures++;
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttempt = Date.now() + this.circuitBreaker.timeout;
      console.error(`🔴 Circuit breaker OPEN - too many failures (${this.circuitBreaker.failures})`);
    }
  }
}

module.exports = KafkaProducer;