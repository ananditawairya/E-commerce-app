// backend/ai-service/src/services/productIndexer.js
// CHANGE: Add Kafka consumer for real-time product indexing

import axios from 'axios';
import embeddingService from './embeddingService.js';
import Redis from 'ioredis';

class ProductIndexer {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.INDEX_KEY = 'product:index';
    this.PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';
  }

  async indexProducts(correlationId) {
    try {
      console.log('📊 Fetching products from product service...');
      
      const response = await axios.get(`${this.PRODUCT_SERVICE_URL}/api/products`, {
        params: { limit: 1000 },
        headers: {
          'X-Correlation-ID': correlationId || 'index-all',
        },
      });

      const products = response.data;
      console.log(`📦 Found ${products.length} products to index`);

      const indexData = [];
      for (const product of products) {
        const searchableText = `${product.name} ${product.description} ${product.category}`;
        const embedding = await embeddingService.generateEmbedding(searchableText);
        
        indexData.push({
          productId: product.id,
          name: product.name,
          category: product.category,
          basePrice: product.basePrice,
          images: product.images,
          embedding: embedding,
        });

        console.log(`✅ Indexed: ${product.name}`);
      }

      await this.redis.set(this.INDEX_KEY, JSON.stringify(indexData));
      console.log(`✅ Product index updated with ${indexData.length} products`);

      return { indexed: indexData.length };
    } catch (error) {
      console.error('❌ Product indexing failed:', error.message);
      const err = new Error('Product indexing failed');
      err.code = 'INDEXING_FAILED';
      throw err;
    }
  }

  // CHANGE: Index single product (for Kafka events)
  async indexSingleProduct(productId, productData) {
    try {
      console.log(`📊 Indexing single product: ${productId}`);

      const searchableText = `${productData.name} ${productData.description} ${productData.category}`;
      const embedding = await embeddingService.generateEmbedding(searchableText);

      const indexData = await this.getIndex();
      
      // CHANGE: Remove existing entry if present
      const filteredIndex = indexData.filter(p => p.productId !== productId);
      
      // CHANGE: Add new entry
      filteredIndex.push({
        productId: productData.id || productId,
        name: productData.name,
        category: productData.category,
        basePrice: productData.basePrice,
        images: productData.images,
        embedding: embedding,
      });

      await this.redis.set(this.INDEX_KEY, JSON.stringify(filteredIndex));
      console.log(`✅ Product indexed: ${productData.name}`);

      return true;
    } catch (error) {
      console.error('❌ Single product indexing failed:', error.message);
      throw error;
    }
  }

  // CHANGE: Remove product from index (for product deletion)
  async removeProductFromIndex(productId) {
    try {
      console.log(`🗑️ Removing product from index: ${productId}`);

      const indexData = await this.getIndex();
      const filteredIndex = indexData.filter(p => p.productId !== productId);

      await this.redis.set(this.INDEX_KEY, JSON.stringify(filteredIndex));
      console.log(`✅ Product removed from index: ${productId}`);

      return true;
    } catch (error) {
      console.error('❌ Product removal failed:', error.message);
      throw error;
    }
  }

  async getIndex() {
    const data = await this.redis.get(this.INDEX_KEY);
    return data ? JSON.parse(data) : [];
  }

  async disconnect() {
    await this.redis.quit();
  }
}

export default new ProductIndexer();