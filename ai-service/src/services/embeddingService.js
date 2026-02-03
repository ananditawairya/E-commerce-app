// CHANGE: Convert to ES Module syntax
import { pipeline } from '@xenova/transformers';
import Redis from 'ioredis';

class EmbeddingService {
  constructor() {
    this.model = null;
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.CACHE_PREFIX = 'embedding:';
    this.CACHE_TTL = 86400; // 24 hours
  }

  async initialize() {
    // CHANGE: Use lightweight sentence-transformers model (runs on CPU)
    // all-MiniLM-L6-v2: 384 dimensions, 22MB, fast inference
    this.model = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('✅ Embedding model initialized');
  }

  async generateEmbedding(text) {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    // CHANGE: Check cache first
    const cacheKey = `${this.CACHE_PREFIX}${text}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // CHANGE: Generate embedding
    const output = await this.model(text, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data);

    // CHANGE: Cache the result
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(embedding));

    return embedding;
  }

  // CHANGE: Cosine similarity for vector comparison
  cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  async disconnect() {
    await this.redis.quit();
  }
}

// CHANGE: Export as default for ES Module
export default new EmbeddingService();