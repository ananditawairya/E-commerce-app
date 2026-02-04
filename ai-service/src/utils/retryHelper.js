// backend/ai-service/src/utils/retryHelper.js
// CHANGE: Retry logic with exponential backoff and jitter

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration
 * @returns {Promise} Result of the function
 */
const retryWithBackoff = async (fn, options = {}) => {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    jitterFactor = 0.3,
    retryableErrors = [], // Array of error codes/messages to retry
    onRetry = null, // Callback on retry
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // CHANGE: Check if error is retryable
      const isRetryable = retryableErrors.length === 0 || 
        retryableErrors.some(pattern => 
          error.code === pattern || 
          error.message?.includes(pattern) ||
          error.response?.status === pattern
        );

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // CHANGE: Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );
      const jitter = baseDelay * jitterFactor * (Math.random() - 0.5);
      const delay = Math.max(0, baseDelay + jitter);

      console.warn(
        `⚠️ Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms - Error: ${error.message}`
      );

      if (onRetry) {
        onRetry(attempt + 1, error, delay);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

module.exports = { retryWithBackoff };