// backend/ai-service/src/utils/circuitBreaker.js
// CHANGE: Centralized circuit breaker configuration for AI service

const CircuitBreaker = require('opossum');

/**
 * Create a circuit breaker with AI service specific configuration
 * @param {Function} action - The async function to wrap
 * @param {Object} options - Circuit breaker options
 * @returns {CircuitBreaker} Configured circuit breaker instance
 */
const createCircuitBreaker = (action, options = {}) => {
  const defaultOptions = {
    timeout: 10000, // 10 seconds
    errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
    resetTimeout: 30000, // Try again after 30 seconds
    rollingCountTimeout: 10000, // 10 second window for error calculation
    rollingCountBuckets: 10,
    name: options.name || 'unnamed-breaker',
    ...options,
  };

  const breaker = new CircuitBreaker(action, defaultOptions);

  // CHANGE: Add event listeners for monitoring
  breaker.on('open', () => {
    console.error(`🔴 Circuit breaker OPEN: ${defaultOptions.name}`);
  });

  breaker.on('halfOpen', () => {
    console.warn(`🟡 Circuit breaker HALF-OPEN: ${defaultOptions.name}`);
  });

  breaker.on('close', () => {
    console.log(`🟢 Circuit breaker CLOSED: ${defaultOptions.name}`);
  });

  breaker.on('fallback', (result) => {
    console.warn(`⚠️ Circuit breaker FALLBACK triggered: ${defaultOptions.name}`);
  });

  return breaker;
};

module.exports = { createCircuitBreaker };