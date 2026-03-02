const crypto = require('crypto');

const DEFAULT_TTL_MS = Number.parseInt(
  process.env.GATEWAY_IDEMPOTENCY_TTL_MS || '900000',
  10
);
const DEFAULT_LOCK_TTL_MS = Number.parseInt(
  process.env.GATEWAY_IDEMPOTENCY_LOCK_TTL_MS || '30000',
  10
);
const REQUIRE_KEY = String(
  process.env.GATEWAY_REQUIRE_IDEMPOTENCY_KEY_FOR_CRITICAL || 'false'
).toLowerCase() === 'true';

const DEFAULT_CRITICAL_OPERATIONS = new Set([
  'Checkout',
  'CreateOrder',
  'ProcessPayment',
]);

/**
 * Recursively sorts object keys for deterministic JSON encoding.
 * @param {unknown} value Any JSON-like value.
 * @return {unknown} Stable sorted value.
 */
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortJson(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

/**
 * Generates a request fingerprint used for idempotency key conflicts.
 * @param {{
 *   operationName: string,
 *   query: string,
 *   variables: object,
 *   userId: string,
 * }} input Fingerprint input.
 * @return {string} Fingerprint hash.
 */
function createFingerprint(input) {
  const payload = JSON.stringify({
    operationName: input.operationName || '',
    query: input.query || '',
    variables: sortJson(input.variables || {}),
    userId: input.userId || 'anonymous',
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Detects whether request targets critical mutation.
 * @param {object} request Express request.
 * @param {Set<string>} criticalOperations Critical operation names.
 * @return {boolean} True when critical.
 */
function isCriticalMutation(request, criticalOperations) {
  const query = typeof request.body?.query === 'string' ? request.body.query : '';
  const operationName = typeof request.body?.operationName === 'string'
    ? request.body.operationName
    : '';

  if (criticalOperations.has(operationName)) {
    return true;
  }

  return query.includes('mutation Checkout')
    || query.includes('mutation CreateOrder')
    || query.includes('mutation ProcessPayment')
    || query.includes('checkout(')
    || query.includes('createOrder(')
    || query.includes('processPayment(');
}

/**
 * Builds idempotency middleware.
 * @param {{
 *   runtimeStore: {
 *     acquireLock: Function,
 *     getIdempotencyRecord: Function,
 *     releaseLock: Function,
 *     setIdempotencyRecord: Function,
 *   },
 *   criticalOperations?: Set<string>,
 *   ttlMs?: number,
 *   lockTtlMs?: number,
 *   requireKey?: boolean,
 * }} options Middleware options.
 * @return {Function} Express middleware.
 */
function createIdempotencyMiddleware(options) {
  const runtimeStore = options.runtimeStore;
  const criticalOperations = options.criticalOperations || DEFAULT_CRITICAL_OPERATIONS;
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const lockTtlMs = Number.isFinite(options.lockTtlMs) ? options.lockTtlMs : DEFAULT_LOCK_TTL_MS;
  const requireKey = typeof options.requireKey === 'boolean' ? options.requireKey : REQUIRE_KEY;

  return async (request, response, next) => {
    try {
      if (request.method !== 'POST' || !isCriticalMutation(request, criticalOperations)) {
        return next();
      }

      const idempotencyKeyHeader = request.headers['idempotency-key'];
      const idempotencyKey = typeof idempotencyKeyHeader === 'string'
        ? idempotencyKeyHeader.trim()
        : '';

      if (!idempotencyKey) {
        if (requireKey) {
          return response.status(400).json({
            error: 'Missing required Idempotency-Key header for critical operation',
          });
        }
        return next();
      }

      const operationName = request.body?.operationName || 'AnonymousMutation';
      const userScope = request.user?.userId || request.ip || 'anonymous';
      const cacheKey = `gateway:idem:v1:${userScope}:${operationName}:${idempotencyKey}`;
      const lockKey = `${cacheKey}:lock`;
      const fingerprint = createFingerprint({
        operationName,
        query: request.body?.query || '',
        variables: request.body?.variables || {},
        userId: userScope,
      });

      const existingRecord = await runtimeStore.getIdempotencyRecord(cacheKey);
      if (existingRecord) {
        if (existingRecord.fingerprint !== fingerprint) {
          return response.status(409).json({
            error: 'Idempotency-Key reuse conflict: request payload differs',
          });
        }

        response.setHeader('Idempotency-Status', 'replayed');
        return response.status(existingRecord.statusCode || 200).json(existingRecord.body);
      }

      const lockAcquired = await runtimeStore.acquireLock(lockKey, lockTtlMs);
      if (!lockAcquired) {
        return response.status(409).json({
          error: 'Duplicate request in progress for this Idempotency-Key',
        });
      }

      const originalJson = response.json.bind(response);
      let finalized = false;
      const finalize = async () => {
        if (finalized) {
          return;
        }
        finalized = true;
        await runtimeStore.releaseLock(lockKey);
      };

      response.on('finish', () => {
        finalize().catch(() => {});
      });
      response.on('close', () => {
        finalize().catch(() => {});
      });

      response.json = (body) => {
        const statusCode = response.statusCode || 200;
        const success = statusCode >= 200 && statusCode < 300;

        if (success) {
          runtimeStore.setIdempotencyRecord(cacheKey, {
            fingerprint,
            statusCode,
            body,
            createdAt: new Date().toISOString(),
          }, ttlMs).catch((error) => {
            console.warn('Failed to persist idempotency record:', error.message);
          });
          response.setHeader('Idempotency-Status', 'stored');
        } else {
          response.setHeader('Idempotency-Status', 'bypassed');
        }

        finalize().catch(() => {});
        return originalJson(body);
      };

      return next();
    } catch (error) {
      console.warn('Idempotency middleware failed, continuing without replay:', error.message);
      return next();
    }
  };
}

module.exports = {
  createIdempotencyMiddleware,
};
