// backend/ai-service/src/services/searchService.js
// CHANGE: Service layer for AI search operations

import embeddingService from './embeddingService.js';
import productIndexer from './productIndexer.js';

class SearchService {
  async performSemanticSearch({ query, limit, threshold }) {
    if (!query || query.trim().length === 0) {
      const error = new Error('Query is required');
      error.code = 'MISSING_QUERY';
      throw error;
    }

    console.log(`🔍 Semantic search: "${query}"`);

    // CHANGE: Generate embedding for search query
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // CHANGE: Get product index
    const productIndex = await productIndexer.getIndex();

    if (productIndex.length === 0) {
      return {
        results: [],
        query,
        count: 0,
        message: 'Product index is empty. Please run indexing first.',
      };
    }

    // CHANGE: Calculate similarity scores
    const scoredProducts = productIndex.map(product => ({
      ...product,
      score: embeddingService.cosineSimilarity(queryEmbedding, product.embedding),
    }));

    // CHANGE: Filter by threshold and sort by score
    const results = scoredProducts
      .filter(p => p.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ embedding, ...product }) => product); // Remove embedding from response

    console.log(`✅ Found ${results.length} results`);

    return {
      results,
      query,
      count: results.length,
    };
  }

  async indexAllProducts(correlationId) {
    return await productIndexer.indexProducts(correlationId);
  }

  async getIndexStatus() {
    const index = await productIndexer.getIndex();
    return {
      indexed: index.length,
      lastUpdated: new Date().toISOString(),
    };
  }

  async indexSingleProduct(productId, productData) {
    return await productIndexer.indexSingleProduct(productId, productData);
  }

  async removeProductFromIndex(productId) {
    return await productIndexer.removeProductFromIndex(productId);
  }
}

export default new SearchService();