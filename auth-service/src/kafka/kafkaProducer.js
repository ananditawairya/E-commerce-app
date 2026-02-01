// backend/auth-service/src/kafka/kafkaProducer.js
// CHANGE: Use shared Kafka producer with service-specific event handlers

const KafkaProducer = require('../../../shared/kafka/KafkaProducer');
const { TOPICS, createUserRegisteredEvent } = require('../../../shared/kafka/events/UserEvents');

class AuthServiceProducer {
  constructor() {
    this.producer = new KafkaProducer('auth-service');
  }

  async connect() {
    return this.producer.connect();
  }

  async disconnect() {
    return this.producer.disconnect();
  }

  async publishUserRegistered(user, correlationId) {
    const event = createUserRegisteredEvent(user);
    const message = this.producer.buildMessage(user.id, event, correlationId);

    // CHANGE: Non-critical event - registration succeeds even if Kafka fails
    return this.producer.publish(TOPICS.USER_REGISTERED, message, {
      critical: false,
      correlationId,
    });
  }
}

module.exports = new AuthServiceProducer();