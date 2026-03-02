const DEFAULT_IDEMPOTENCY_TTL_MS = Number.parseInt(
  process.env.GATEWAY_IDEMPOTENCY_TTL_MS || '900000',
  10
);
const DEFAULT_LOCK_TTL_MS = Number.parseInt(
  process.env.GATEWAY_IDEMPOTENCY_LOCK_TTL_MS || '30000',
  10
);
const SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.GATEWAY_RUNTIME_STORE_SWEEP_INTERVAL_MS || '60000',
  10
);

/**
 * Runtime store for gateway concerns:
 * - Redis-backed rate-limit store factory
 * - Redis/memory-backed idempotency records
 */
class RuntimeStore {
  constructor() {
    this.redisClient = null;
    this.redisReady = false;
    this.redisUrl = process.env.GATEWAY_REDIS_URL || process.env.REDIS_URL || '';

    this.idempotencyMemory = new Map();
    this.lockMemory = new Map();
    this.sweepTimer = setInterval(() => this.sweepMemory(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /**
   * Connects Redis client if configured.
   * @return {Promise<void>} Completion promise.
   */
  async connect() {
    if (!this.redisUrl) {
      return;
    }

    try {
      // Optional dependency.
      // eslint-disable-next-line global-require
      const { createClient } = require('redis');
      this.redisClient = createClient({ url: this.redisUrl });
      this.redisClient.on('error', (error) => {
        console.warn('Gateway Redis error:', error.message);
      });
      await this.redisClient.connect();
      this.redisReady = true;
      console.log('✅ Gateway Redis connected');
    } catch (error) {
      this.redisClient = null;
      this.redisReady = false;
      console.warn('⚠️  Gateway Redis unavailable, using memory fallback:', error.message);
    }
  }

  /**
   * Disconnects Redis client.
   * @return {Promise<void>} Completion promise.
   */
  async disconnect() {
    if (!this.redisReady || !this.redisClient) {
      return;
    }

    try {
      await this.redisClient.quit();
      this.redisReady = false;
      this.redisClient = null;
    } catch (error) {
      console.warn('Gateway Redis quit warning:', error.message);
    }
  }

  /**
   * Returns current runtime store mode.
   * @return {string} `redis` or `memory`.
   */
  getMode() {
    return this.redisReady ? 'redis' : 'memory';
  }

  /**
   * Creates a rate-limit store for express-rate-limit.
   * Returns null when redis is unavailable.
   * @param {string} prefix Key prefix.
   * @return {object|null} Rate-limit store instance.
   */
  createRateLimitStore(prefix) {
    if (!this.redisReady || !this.redisClient) {
      return null;
    }

    try {
      // Optional dependency.
      // eslint-disable-next-line global-require
      const redisStoreModule = require('rate-limit-redis');
      const RedisStore = redisStoreModule.RedisStore
        || redisStoreModule.default
        || redisStoreModule;
      return new RedisStore({
        prefix: `gateway:rl:${prefix}:`,
        sendCommand: (...args) => this.redisClient.sendCommand(args),
      });
    } catch (error) {
      console.warn('rate-limit-redis unavailable, falling back to memory store:', error.message);
      return null;
    }
  }

  /**
   * Reads idempotency record.
   * @param {string} key Idempotency key.
   * @return {Promise<object|null>} Cached record.
   */
  async getIdempotencyRecord(key) {
    if (!key) {
      return null;
    }

    if (this.redisReady && this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.warn('Redis idempotency read failed:', error.message);
      }
    }

    const entry = this.idempotencyMemory.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.idempotencyMemory.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Writes idempotency record with TTL.
   * @param {string} key Idempotency key.
   * @param {object} value Record value.
   * @param {number} ttlMs TTL in milliseconds.
   * @return {Promise<void>} Completion promise.
   */
  async setIdempotencyRecord(key, value, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS) {
    if (!key) {
      return;
    }

    const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_IDEMPOTENCY_TTL_MS;
    if (this.redisReady && this.redisClient) {
      try {
        await this.redisClient.set(key, JSON.stringify(value), {
          PX: safeTtlMs,
        });
        return;
      } catch (error) {
        console.warn('Redis idempotency write failed:', error.message);
      }
    }

    this.idempotencyMemory.set(key, {
      value,
      expiresAt: Date.now() + safeTtlMs,
    });
  }

  /**
   * Acquires a distributed/local lock.
   * @param {string} key Lock key.
   * @param {number} ttlMs Lock TTL.
   * @return {Promise<boolean>} True when acquired.
   */
  async acquireLock(key, ttlMs = DEFAULT_LOCK_TTL_MS) {
    if (!key) {
      return false;
    }

    const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LOCK_TTL_MS;
    if (this.redisReady && this.redisClient) {
      try {
        const response = await this.redisClient.set(key, '1', {
          NX: true,
          PX: safeTtlMs,
        });
        return response === 'OK';
      } catch (error) {
        console.warn('Redis lock acquire failed:', error.message);
      }
    }

    const current = this.lockMemory.get(key);
    if (current && current.expiresAt > Date.now()) {
      return false;
    }

    this.lockMemory.set(key, { expiresAt: Date.now() + safeTtlMs });
    return true;
  }

  /**
   * Releases a distributed/local lock.
   * @param {string} key Lock key.
   * @return {Promise<void>} Completion promise.
   */
  async releaseLock(key) {
    if (!key) {
      return;
    }

    if (this.redisReady && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        console.warn('Redis lock release failed:', error.message);
      }
      return;
    }

    this.lockMemory.delete(key);
  }

  /**
   * Sweeps expired memory keys.
   * @return {void} No return value.
   */
  sweepMemory() {
    const now = Date.now();
    for (const [key, entry] of this.idempotencyMemory.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.idempotencyMemory.delete(key);
      }
    }

    for (const [key, entry] of this.lockMemory.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.lockMemory.delete(key);
      }
    }
  }
}

module.exports = new RuntimeStore();
