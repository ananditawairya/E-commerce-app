const {
  SEMANTIC_REINDEX_DELAY_MS,
  SEMANTIC_SEARCH_TIMEOUT_MS,
} = require('./config');
const { extractErrorMessage, withTimeout } = require('./helpers');
const { getPublicStatus, isEnabled } = require('./availability');
const { isIndexFresh, loadIndexFromCache, rebuildIndex } = require('./indexBuilder');
const { INDEX_CACHE_KEY } = require('./config');
const cacheService = require('../cacheService');

/**
 * Starts semantic index rebuild if no build is currently running.
 * @param {object} service SemanticSearchService instance.
 * @param {string=} reason Rebuild reason.
 * @return {Promise<object>} Build promise.
 */
function startRebuild(service, reason = 'manual') {
  if (service.indexBuildPromise) {
    return service.indexBuildPromise;
  }

  service.indexBuildPromise = rebuildIndex(service, reason)
    .catch((error) => {
      const errorMessage = extractErrorMessage(error);
      service.lastError = {
        message: errorMessage,
        at: new Date().toISOString(),
        reason,
      };
      console.warn('Semantic index rebuild failed:', errorMessage);
      return getPublicStatus(service);
    })
    .finally(() => {
      service.indexBuildPromise = null;
    });

  return service.indexBuildPromise;
}

/**
 * Schedules deferred semantic index rebuild.
 * @param {object} service SemanticSearchService instance.
 * @param {string=} reason Rebuild reason.
 * @return {void} No return value.
 */
function scheduleReindex(service, reason = 'scheduled') {
  if (!isEnabled(service)) {
    return;
  }

  if (service.reindexTimer) {
    return;
  }

  service.reindexTimer = setTimeout(() => {
    service.reindexTimer = null;
    startRebuild(service, reason);
  }, SEMANTIC_REINDEX_DELAY_MS);

  service.reindexTimer.unref();
}

/**
 * Ensures semantic index availability.
 * @param {object} service SemanticSearchService instance.
 * @param {{force?: boolean, waitForBuild?: boolean, reason?: string}=} options Ensure options.
 * @return {Promise<{ready: boolean, cacheHit: boolean, building: boolean}>} Ensure status.
 */
async function ensureIndex(service, { force = false, waitForBuild = false, reason = 'ensure' } = {}) {
  if (!isEnabled(service)) {
    return {
      ready: false,
      cacheHit: false,
      building: false,
    };
  }

  if (force) {
    await startRebuild(service, reason);
    return {
      ready: service.index.products.length > 0,
      cacheHit: false,
      building: Boolean(service.indexBuildPromise),
    };
  }

  if (isIndexFresh(service)) {
    return {
      ready: true,
      cacheHit: true,
      building: Boolean(service.indexBuildPromise),
    };
  }

  const loadedFromCache = await loadIndexFromCache(service);
  if (loadedFromCache && isIndexFresh(service)) {
    return {
      ready: true,
      cacheHit: true,
      building: Boolean(service.indexBuildPromise),
    };
  }

  startRebuild(service, reason);

  if (waitForBuild && service.indexBuildPromise) {
    await withTimeout(
      service.indexBuildPromise,
      SEMANTIC_SEARCH_TIMEOUT_MS,
      'Semantic index build timeout'
    );
  }

  return {
    ready: service.index.products.length > 0,
    cacheHit: loadedFromCache,
    building: Boolean(service.indexBuildPromise),
  };
}

/**
 * Forces synchronous semantic reindex and returns latest status.
 * @param {object} service SemanticSearchService instance.
 * @param {string=} reason Reindex reason.
 * @return {Promise<object>} Status payload.
 */
async function forceReindex(service, reason = 'manual_api') {
  const status = await ensureIndex(service, {
    force: true,
    waitForBuild: true,
    reason,
  });

  return {
    ...getPublicStatus(service),
    ready: status.ready,
  };
}

/**
 * Invalidates semantic index and triggers asynchronous rebuild.
 * @param {object} service SemanticSearchService instance.
 * @param {string=} reason Invalidate reason.
 * @return {Promise<object>} Status payload.
 */
async function invalidateIndex(service, reason = 'manual_invalidate') {
  service.index = {
    products: [],
    updatedAt: 0,
    source: reason,
    stats: {
      indexed: 0,
      skipped: 0,
      failed: 0,
    },
  };
  await cacheService.delete(INDEX_CACHE_KEY);
  scheduleReindex(service, reason);
  return getPublicStatus(service);
}

module.exports = {
  ensureIndex,
  forceReindex,
  invalidateIndex,
  scheduleReindex,
  startRebuild,
};
