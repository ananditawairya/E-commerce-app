const DEFAULT_TTL_MS = Number.parseInt(
  process.env.PRODUCT_CACHE_DEFAULT_TTL_MS || '120000',
  10
);
const JITTER_RATIO = Number.parseFloat(
  process.env.PRODUCT_CACHE_TTL_JITTER_RATIO || '0.2'
);
const MEMORY_SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.PRODUCT_CACHE_SWEEP_INTERVAL_MS || '60000',
  10
);
const NAMESPACE_VERSION_PREFIX = 'product:cache:ns:v1:';

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
    const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    const safeRatio = Number.isFinite(JITTER_RATIO) && JITTER_RATIO >= 0 ? JITTER_RATIO : 0;
    const extra = Math.floor(Math.random() * safeTtlMs * safeRatio);
    return safeTtlMs + extra;
  }

  /**
   * Sweeps expired memory entries.
   * @return {void} No return value.
   */
  sweepMemory() {
    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.memoryStore.delete(key);
      }
    }
  }

  /**
   * Reads JSON value by key.
   * @param {string} key Cache key.
   * @return {Promise<unknown|null>} Cached value.
   */
  async getJson(key) {
    if (!key) {
      return null;
    }

    if (this.redisModeEnabled && this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.warn('Product cache Redis get failed:', error.message);
      }
    }

    const entry = this.memoryStore.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.memoryStore.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Writes JSON value by key with TTL.
   * @param {string} key Cache key.
   * @param {unknown} value Value payload.
   * @param {number} ttlMs TTL in ms.
   * @return {Promise<void>} Completion promise.
   */
  async setJson(key, value, ttlMs = DEFAULT_TTL_MS) {
    if (!key) {
      return;
    }

    const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    if (this.redisModeEnabled && this.redisClient) {
      try {
        await this.redisClient.set(key, JSON.stringify(value), {
          PX: safeTtlMs,
        });
        return;
      } catch (error) {
        console.warn('Product cache Redis set failed:', error.message);
      }
    }

    this.memoryStore.set(key, {
      value,
      expiresAt: Date.now() + safeTtlMs,
    });
  }

  /**
   * Removes one key from cache.
   * @param {string} key Cache key.
   * @return {Promise<void>} Completion promise.
   */
  async delete(key) {
    if (!key) {
      return;
    }

    this.memoryStore.delete(key);
    if (this.redisModeEnabled && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        console.warn('Product cache Redis delete failed:', error.message);
      }
    }
  }

  /**
   * Deduplicates concurrent async work by key.
   * @template T
   * @param {string} key Singleflight key.
   * @param {() => Promise<T>} fetcher Promise fetcher.
   * @return {Promise<T>} Shared result promise.
   */
  withSingleflight(key, fetcher) {
    if (!key) {
      return fetcher();
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        return await fetcher();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
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
    const safeNamespace = String(namespace || '').trim();
    if (!safeNamespace) {
      return 1;
    }

    const redisKey = `${NAMESPACE_VERSION_PREFIX}${safeNamespace}`;
    if (this.redisModeEnabled && this.redisClient) {
      try {
        const currentValue = await this.redisClient.get(redisKey);
        if (currentValue) {
          return Number.parseInt(currentValue, 10) || 1;
        }

        await this.redisClient.set(redisKey, '1');
        return 1;
      } catch (error) {
        console.warn('Product cache namespace read failed:', error.message);
      }
    }

    if (!this.memoryNamespaceVersions.has(safeNamespace)) {
      this.memoryNamespaceVersions.set(safeNamespace, 1);
    }
    return this.memoryNamespaceVersions.get(safeNamespace);
  }

  /**
   * Increments namespace version to invalidate old keys.
   * @param {string} namespace Namespace name.
   * @return {Promise<number>} New namespace version.
   */
  async bumpNamespaceVersion(namespace) {
    const safeNamespace = String(namespace || '').trim();
    if (!safeNamespace) {
      return 1;
    }

    const redisKey = `${NAMESPACE_VERSION_PREFIX}${safeNamespace}`;
    if (this.redisModeEnabled && this.redisClient) {
      try {
        const next = await this.redisClient.incr(redisKey);
        return Number.parseInt(next, 10) || 1;
      } catch (error) {
        console.warn('Product cache namespace bump failed:', error.message);
      }
    }

    const current = this.memoryNamespaceVersions.get(safeNamespace) || 1;
    const next = current + 1;
    this.memoryNamespaceVersions.set(safeNamespace, next);
    return next;
  }
}

module.exports = new CacheService();
