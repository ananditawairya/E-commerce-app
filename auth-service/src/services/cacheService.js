const { appLogger } = require('../utils/logger');

const DEFAULT_TTL_MS = Number.parseInt(process.env.AUTH_CACHE_DEFAULT_TTL_MS || '300000', 10);
const MEMORY_SWEEP_INTERVAL_MS = Number.parseInt(process.env.AUTH_CACHE_SWEEP_INTERVAL_MS || '60000', 10);
const MEMORY_MAX_ITEMS = Number.parseInt(process.env.AUTH_CACHE_MAX_ITEMS || '5000', 10);

class CacheService {
  constructor() {
    this.redisClient = null;
    this.redisModeEnabled = false;
    this.cacheDisabled = (process.env.AUTH_CACHE_MODE || 'auto').toLowerCase() === 'off';
    this.forceMemoryMode = (process.env.AUTH_CACHE_MODE || 'auto').toLowerCase() === 'memory';
    this.memoryStore = new Map();
    this.memorySweepTimer = setInterval(() => this.sweepMemory(), MEMORY_SWEEP_INTERVAL_MS);
    this.memorySweepTimer.unref();
  }

  async connect() {
    if (this.cacheDisabled || this.forceMemoryMode) {
      return;
    }

    const redisUrl = process.env.AUTH_REDIS_URL || process.env.REDIS_URL;
    if (!redisUrl) {
      return;
    }

    try {
      // Optional dependency; service falls back to memory cache if unavailable.
      // eslint-disable-next-line global-require
      const { createClient } = require('redis');
      this.redisClient = createClient({ url: redisUrl });

      this.redisClient.on('error', (error) => {
        appLogger.warn({ error: error.message }, 'Redis cache client error');
      });

      await this.redisClient.connect();
      this.redisModeEnabled = true;
      appLogger.info({ redisUrl }, 'Redis cache connected');
    } catch (error) {
      this.redisClient = null;
      this.redisModeEnabled = false;
      appLogger.warn({ error: error.message }, 'Redis unavailable, using in-memory cache');
    }
  }

  async disconnect() {
    if (this.redisClient && this.redisModeEnabled) {
      try {
        await this.redisClient.quit();
      } catch (error) {
        appLogger.warn({ error: error.message }, 'Redis disconnect warning');
      }
    }
  }

  getMode() {
    if (this.cacheDisabled) {
      return 'off';
    }

    return this.redisModeEnabled ? 'redis' : 'memory';
  }

  buildEntry(value, ttlMs) {
    const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    return {
      value,
      expiresAt: Date.now() + safeTtl,
    };
  }

  enforceMemorySizeLimit() {
    if (this.memoryStore.size <= MEMORY_MAX_ITEMS) {
      return;
    }

    const oldestKey = this.memoryStore.keys().next().value;
    if (oldestKey) {
      this.memoryStore.delete(oldestKey);
    }
  }

  sweepMemory() {
    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.memoryStore.delete(key);
      }
    }
  }

  async getJson(key) {
    if (!key || this.cacheDisabled) {
      return null;
    }

    if (this.redisModeEnabled && this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        appLogger.warn({ key, error: error.message }, 'Redis get failed, falling back to memory');
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

  async setJson(key, value, ttlMs = DEFAULT_TTL_MS) {
    if (!key || this.cacheDisabled) {
      return;
    }

    if (this.redisModeEnabled && this.redisClient) {
      try {
        const safeTtlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
        await this.redisClient.set(key, JSON.stringify(value), {
          EX: safeTtlSeconds,
        });
      } catch (error) {
        appLogger.warn({ key, error: error.message }, 'Redis set failed, writing to memory');
        this.memoryStore.set(key, this.buildEntry(value, ttlMs));
        this.enforceMemorySizeLimit();
      }
      return;
    }

    this.memoryStore.set(key, this.buildEntry(value, ttlMs));
    this.enforceMemorySizeLimit();
  }

  async delete(key) {
    if (!key || this.cacheDisabled) {
      return;
    }

    this.memoryStore.delete(key);

    if (this.redisModeEnabled && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        appLogger.warn({ key, error: error.message }, 'Redis delete failed');
      }
    }
  }

  async withJsonCache(key, ttlMs, fetcher) {
    const cached = await this.getJson(key);
    if (cached !== null) {
      return {
        value: cached,
        cacheHit: true,
      };
    }

    const fresh = await fetcher();
    await this.setJson(key, fresh, ttlMs);

    return {
      value: fresh,
      cacheHit: false,
    };
  }
}

module.exports = new CacheService();
