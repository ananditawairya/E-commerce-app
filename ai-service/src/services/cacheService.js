// ai-service/src/services/cacheService.js
// Redis-first cache with in-memory fallback for low-latency AI operations.

const DEFAULT_TTL_MS = Number.parseInt(process.env.AI_CACHE_DEFAULT_TTL_MS || '300000', 10);
const MEMORY_SWEEP_INTERVAL_MS = Number.parseInt(process.env.AI_CACHE_SWEEP_INTERVAL_MS || '60000', 10);

class CacheService {
    constructor() {
        this.redisClient = null;
        this.redisModeEnabled = false;
        this.memoryStore = new Map();
        this.memorySweepTimer = setInterval(() => this.sweepMemory(), MEMORY_SWEEP_INTERVAL_MS);
        this.memorySweepTimer.unref();
    }

    async connect() {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            return;
        }

        try {
            // Optional dependency: service still works without redis installed.
            // eslint-disable-next-line global-require
            const { createClient } = require('redis');
            this.redisClient = createClient({ url: redisUrl });

            this.redisClient.on('error', (error) => {
                console.error('Redis cache error:', error.message);
            });

            await this.redisClient.connect();
            this.redisModeEnabled = true;
            console.log('✅ Redis cache connected');
        } catch (error) {
            this.redisClient = null;
            this.redisModeEnabled = false;
            console.warn('⚠️  Redis unavailable, using in-memory cache only:', error.message);
        }
    }

    async disconnect() {
        if (this.redisClient && this.redisModeEnabled) {
            try {
                await this.redisClient.quit();
            } catch (error) {
                console.warn('Redis disconnect warning:', error.message);
            }
        }
    }

    getMode() {
        return this.redisModeEnabled ? 'redis' : 'memory';
    }

    buildEntry(value, ttlMs) {
        const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
        return {
            value,
            expiresAt: Date.now() + safeTtl,
        };
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
        if (!key) {
            return null;
        }

        if (this.redisModeEnabled && this.redisClient) {
            try {
                const raw = await this.redisClient.get(key);
                return raw ? JSON.parse(raw) : null;
            } catch (error) {
                console.warn(`Redis get failed for ${key}, falling back to memory:`, error.message);
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
        if (!key) {
            return;
        }

        if (this.redisModeEnabled && this.redisClient) {
            try {
                const safeTtlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
                await this.redisClient.set(key, JSON.stringify(value), {
                    EX: safeTtlSeconds,
                });
            } catch (error) {
                console.warn(`Redis set failed for ${key}, writing to memory:`, error.message);
                this.memoryStore.set(key, this.buildEntry(value, ttlMs));
            }
            return;
        }

        this.memoryStore.set(key, this.buildEntry(value, ttlMs));
    }

    async delete(key) {
        if (!key) {
            return;
        }

        this.memoryStore.delete(key);

        if (this.redisModeEnabled && this.redisClient) {
            try {
                await this.redisClient.del(key);
            } catch (error) {
                console.warn(`Redis delete failed for ${key}:`, error.message);
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
