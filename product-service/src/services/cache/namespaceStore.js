const { NAMESPACE_VERSION_PREFIX } = require('./constants');

/**
 * Returns namespace version used for broad cache invalidation.
 * @param {{
 *   redisModeEnabled: boolean,
 *   redisClient: object|null,
 *   memoryNamespaceVersions: Map<string, number>,
 * }} state Cache state.
 * @param {string} namespace Namespace name.
 * @return {Promise<number>} Namespace version.
 */
async function getNamespaceVersion(state, namespace) {
  const safeNamespace = String(namespace || '').trim();
  if (!safeNamespace) {
    return 1;
  }

  const redisKey = `${NAMESPACE_VERSION_PREFIX}${safeNamespace}`;
  if (state.redisModeEnabled && state.redisClient) {
    try {
      const currentValue = await state.redisClient.get(redisKey);
      if (currentValue) {
        return Number.parseInt(currentValue, 10) || 1;
      }

      await state.redisClient.set(redisKey, '1');
      return 1;
    } catch (error) {
      console.warn('Product cache namespace read failed:', error.message);
    }
  }

  if (!state.memoryNamespaceVersions.has(safeNamespace)) {
    state.memoryNamespaceVersions.set(safeNamespace, 1);
  }
  return state.memoryNamespaceVersions.get(safeNamespace);
}

/**
 * Increments namespace version to invalidate old keys.
 * @param {{
 *   redisModeEnabled: boolean,
 *   redisClient: object|null,
 *   memoryNamespaceVersions: Map<string, number>,
 * }} state Cache state.
 * @param {string} namespace Namespace name.
 * @return {Promise<number>} Next namespace version.
 */
async function bumpNamespaceVersion(state, namespace) {
  const safeNamespace = String(namespace || '').trim();
  if (!safeNamespace) {
    return 1;
  }

  const redisKey = `${NAMESPACE_VERSION_PREFIX}${safeNamespace}`;
  if (state.redisModeEnabled && state.redisClient) {
    try {
      const next = await state.redisClient.incr(redisKey);
      return Number.parseInt(next, 10) || 1;
    } catch (error) {
      console.warn('Product cache namespace bump failed:', error.message);
    }
  }

  const current = state.memoryNamespaceVersions.get(safeNamespace) || 1;
  const next = current + 1;
  state.memoryNamespaceVersions.set(safeNamespace, next);
  return next;
}

module.exports = {
  bumpNamespaceVersion,
  getNamespaceVersion,
};
