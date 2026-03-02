const {
  DEFAULT_TTL_MS,
  MEMORY_SWEEP_INTERVAL_MS,
} = require('./cache/constants');
const {
  applyTtlJitter,
  sweepMemory,
} = require('./cache/memory');
const {
  deleteKey,
  getJson,
  setJson,
} = require('./cache/jsonStore');
const {
  bumpNamespaceVersion,
  getNamespaceVersion,
} = require('./cache/namespaceStore');
const { withSingleflight } = require('./cache/singleflight');

/**
 * Product service cache:
 * - Redis-first with memory fallback.
 * - Cache-aside helper with TTL jitter.
 * - Singleflight deduplication for concurrent misses.
 * - Namespace versioning for invalidation.
 */
class CacheService {
  constructor() {
    this.redisClient = null;
    this.redisModeEnabled = false;
    this.memoryStore = new Map();
    this.memoryNamespaceVersions = new Map();
    this.inFlight = new Map();
    this.sweepTimer = setInterval(
      () => this.sweepMemory(),
      MEMORY_SWEEP_INTERVAL_MS
    );
    this.sweepTimer.unref();
  }

  /**
   * Connects Redis if configured.
   * @return {Promise<void>} Completion promise.
   */
  async connect() {
    const redisUrl = process.env.PRODUCT_REDIS_URL || process.env.REDIS_URL;
    if (!redisUrl) {
      return;
    }

    try {
      // Optional dependency.
      // eslint-disable-next-line global-require
      const { createClient } = require('redis');
      this.redisClient = createClient({ url: redisUrl });
      this.redisClient.on('error', (error) => {
        console.warn('Product cache Redis error:', error.message);
      });
      await this.redisClient.connect();
      this.redisModeEnabled = true;
      console.log('✅ Product cache Redis connected');
    } catch (error) {
      this.redisClient = null;
      this.redisModeEnabled = false;
      console.warn('⚠️  Product cache Redis unavailable, using memory cache:', error.message);
    }
  }

  /**
   * Disconnects Redis.
   * @return {Promise<void>} Completion promise.
   */
  async disconnect() {
    if (!this.redisModeEnabled || !this.redisClient) {
      return;
    }

    try {
      await this.redisClient.quit();
      this.redisModeEnabled = false;
      this.redisClient = null;
    } catch (error) {
      console.warn('Product cache Redis quit warning:', error.message);
    }
  }

  /**
   * Returns active cache mode.
   * @return {string} Cache mode.
   */
  getMode() {
    return this.redisModeEnabled ? 'redis' : 'memory';
  }

  /**
   * Adds TTL jitter to reduce synchronized expirations.
   * @param {number} ttlMs Base TTL.
   * @return {number} Jittered TTL.
   */
  applyTtlJitter(ttlMs) {
    return applyTtlJitter(ttlMs);
  }

  /**
   * Sweeps expired memory entries.
   * @return {void} No return value.
   */
  sweepMemory() {
    return sweepMemory(this);
  }

  /**
   * Reads JSON value by key.
   * @param {string} key Cache key.
   * @return {Promise<unknown|null>} Cached value.
   */
  async getJson(key) {
    return getJson(this, key);
  }

  /**
   * Writes JSON value by key with TTL.
   * @param {string} key Cache key.
   * @param {unknown} value Value payload.
   * @param {number} ttlMs TTL in ms.
   * @return {Promise<void>} Completion promise.
   */
  async setJson(key, value, ttlMs = DEFAULT_TTL_MS) {
    return setJson(this, key, value, ttlMs);
  }

  /**
   * Removes one key from cache.
   * @param {string} key Cache key.
   * @return {Promise<void>} Completion promise.
   */
  async delete(key) {
    return deleteKey(this, key);
  }

  /**
   * Deduplicates concurrent async work by key.
   * @template T
   * @param {string} key Singleflight key.
   * @param {() => Promise<T>} fetcher Promise fetcher.
   * @return {Promise<T>} Shared result promise.
   */
  withSingleflight(key, fetcher) {
    return withSingleflight(this, key, fetcher);
  }

  /**
   * Cache-aside helper with jittered TTL and promise dedup.
   * @template T
   * @param {{
   *   key: string,
   *   baseTtlMs?: number,
   *   fetcher: () => Promise<T>,
   * }} options Cache options.
   * @return {Promise<{value: T, cacheHit: boolean}>} Result payload.
   */
  async withCacheAside(options) {
    const key = options.key;
    const baseTtlMs = Number.isFinite(options.baseTtlMs)
      ? options.baseTtlMs
      : DEFAULT_TTL_MS;

    const cached = await this.getJson(key);
    if (cached !== null) {
      return {
        value: cached,
        cacheHit: true,
      };
    }

    return this.withSingleflight(`sf:${key}`, async () => {
      const secondRead = await this.getJson(key);
      if (secondRead !== null) {
        return {
          value: secondRead,
          cacheHit: true,
        };
      }

      const fresh = await options.fetcher();
      await this.setJson(key, fresh, this.applyTtlJitter(baseTtlMs));
      return {
        value: fresh,
        cacheHit: false,
      };
    });
  }

  /**
   * Gets namespace version used for cheap broad invalidation.
   * @param {string} namespace Namespace name.
   * @return {Promise<number>} Namespace version.
   */
  async getNamespaceVersion(namespace) {
    return getNamespaceVersion(this, namespace);
  }

  /**
   * Increments namespace version to invalidate old keys.
   * @param {string} namespace Namespace name.
   * @return {Promise<number>} New namespace version.
   */
  async bumpNamespaceVersion(namespace) {
    return bumpNamespaceVersion(this, namespace);
  }
}

module.exports = new CacheService();
