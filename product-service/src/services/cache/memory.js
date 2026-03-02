const {
  DEFAULT_TTL_MS,
  JITTER_RATIO,
} = require('./constants');

/**
 * Adds TTL jitter to reduce synchronized expirations.
 * @param {number} ttlMs Base TTL.
 * @return {number} Jittered TTL.
 */
function applyTtlJitter(ttlMs) {
  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  const safeRatio = Number.isFinite(JITTER_RATIO) && JITTER_RATIO >= 0 ? JITTER_RATIO : 0;
  const extra = Math.floor(Math.random() * safeTtlMs * safeRatio);
  return safeTtlMs + extra;
}

/**
 * Sweeps expired entries from in-memory cache.
 * @param {{memoryStore: Map<string, {expiresAt: number}>}} state Cache service state.
 * @return {void}
 */
function sweepMemory(state) {
  const now = Date.now();
  for (const [key, entry] of state.memoryStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      state.memoryStore.delete(key);
    }
  }
}

module.exports = {
  applyTtlJitter,
  sweepMemory,
};
