const { CATALOG_NAMESPACE } = require('./constants');

/**
 * Bumps catalog namespace to invalidate stale cache keys.
 * @param {object|undefined} cacheService Cache service.
 * @return {Promise<void>} Completion promise.
 */
async function invalidateCatalogCache(cacheService) {
  if (!cacheService || typeof cacheService.bumpNamespaceVersion !== 'function') {
    return;
  }

  try {
    await cacheService.bumpNamespaceVersion(CATALOG_NAMESPACE);
  } catch (error) {
    console.warn('Failed to invalidate product catalog cache namespace:', error.message);
  }
}

module.exports = {
  invalidateCatalogCache,
};
