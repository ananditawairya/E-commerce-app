/**
 * Cache helper utilities for catalog operations.
 */

/**
 * Reads namespace version with safe fallback.
 * @param {object|undefined} cacheService Cache service.
 * @param {string} namespace Namespace name.
 * @return {Promise<number>} Namespace version.
 */
async function getNamespaceVersion(cacheService, namespace) {
  if (!cacheService || typeof cacheService.getNamespaceVersion !== 'function') {
    return 1;
  }

  try {
    return await cacheService.getNamespaceVersion(namespace);
  } catch (error) {
    console.warn('Failed to read cache namespace version:', error.message);
    return 1;
  }
}

/**
 * Executes cache-aside flow when cache service is available.
 * @template T
 * @param {object|undefined} cacheService Cache service.
 * @param {string} key Cache key.
 * @param {number} ttlMs Base TTL.
 * @param {() => Promise<T>} fetcher Source fetcher.
 * @return {Promise<T>} Resolved value.
 */
async function withOptionalCache(cacheService, key, ttlMs, fetcher) {
  if (!cacheService || typeof cacheService.withCacheAside !== 'function') {
    return fetcher();
  }

  const { value } = await cacheService.withCacheAside({
    key,
    baseTtlMs: ttlMs,
    fetcher,
  });
  return value;
}

module.exports = {
  getNamespaceVersion,
  withOptionalCache,
};
