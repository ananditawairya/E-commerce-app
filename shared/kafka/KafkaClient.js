// backend/shared/kafka/KafkaClient.js
// CHANGE: Centralized Kafka client with connection pooling

const { Kafka, logLevel } = require('kafkajs');

class KafkaClient {
  constructor(clientId) {
    if (!clientId) {
      throw new Error('clientId is required for KafkaClient');
    }

    this.kafka = new Kafka({
      clientId,
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      // CHANGE: Add connection timeout and retry configuration
      connectionTimeout: 10000,
      requestTimeout: 30000,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
        // CHANGE: Add jitter to prevent thundering herd
        factor: 0.2,
      },
      // CHANGE: Add logging configuration
      logLevel: process.env.KAFKA_LOG_LEVEL 
        ? logLevel[process.env.KAFKA_LOG_LEVEL.toUpperCase()] 
        : logLevel.ERROR,
    });

    this.clientId = clientId;
  }

  // CHANGE: Factory method for producers with consistent config
  createProducer(config = {}) {
    return this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      // CHANGE: Add idempotence for exactly-once semantics
      idempotent: true,
      maxInFlightRequests: 5,
      // CHANGE: Add compression for better throughput
      compression: 1, // GZIP
      ...config,
    });
  }

  // CHANGE: Factory method for consumers with consistent config
  createConsumer(groupId, config = {}) {
    if (!groupId) {
      throw new Error('groupId is required for consumer');
    }

    return this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      // CHANGE: Add rebalance timeout
      rebalanceTimeout: 60000,
      // CHANGE: Enable auto-commit with safe interval
      autoCommit: true,
      autoCommitInterval: 5000,
      ...config,
    });
  }

  // CHANGE: Admin client for topic management
  createAdmin() {
    return this.kafka.admin();
  }
}

module.exports = KafkaClient;