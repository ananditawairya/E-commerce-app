const { DEFAULT_TTL_MS } = require('./constants');

/**
 * Reads JSON cache value by key.
 * @param {{
 *   redisModeEnabled: boolean,
 *   redisClient: object|null,
 *   memoryStore: Map<string, {value: unknown, expiresAt: number}>,
 * }} state Cache state.
 * @param {string} key Cache key.
 * @return {Promise<unknown|null>} Cached value.
 */
async function getJson(state, key) {
  if (!key) {
    return null;
  }

  if (state.redisModeEnabled && state.redisClient) {
    try {
      const raw = await state.redisClient.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('Product cache Redis get failed:', error.message);
    }
  }

  const entry = state.memoryStore.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    state.memoryStore.delete(key);
    return null;
  }

  return entry.value;
}

/**
 * Writes JSON cache value by key with TTL.
 * @param {{
 *   redisModeEnabled: boolean,
 *   redisClient: object|null,
 *   memoryStore: Map<string, {value: unknown, expiresAt: number}>,
 * }} state Cache state.
 * @param {string} key Cache key.
 * @param {unknown} value Value payload.
 * @param {number=} ttlMs TTL in ms.
 * @return {Promise<void>} Completion promise.
 */
async function setJson(state, key, value, ttlMs = DEFAULT_TTL_MS) {
  if (!key) {
    return;
  }

  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  if (state.redisModeEnabled && state.redisClient) {
    try {
      await state.redisClient.set(key, JSON.stringify(value), {
        PX: safeTtlMs,
      });
      return;
    } catch (error) {
      console.warn('Product cache Redis set failed:', error.message);
    }
  }

  state.memoryStore.set(key, {
    value,
    expiresAt: Date.now() + safeTtlMs,
  });
}

/**
 * Deletes one cache key from Redis and memory.
 * @param {{
 *   redisModeEnabled: boolean,
 *   redisClient: object|null,
 *   memoryStore: Map<string, {value: unknown, expiresAt: number}>,
 * }} state Cache state.
 * @param {string} key Cache key.
 * @return {Promise<void>} Completion promise.
 */
async function deleteKey(state, key) {
  if (!key) {
    return;
  }

  state.memoryStore.delete(key);
  if (state.redisModeEnabled && state.redisClient) {
    try {
      await state.redisClient.del(key);
    } catch (error) {
      console.warn('Product cache Redis delete failed:', error.message);
    }
  }
}

module.exports = {
  deleteKey,
  getJson,
  setJson,
};
