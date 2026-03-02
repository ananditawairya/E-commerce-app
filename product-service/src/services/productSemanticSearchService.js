const Product = require('../models/Product');
const ProductSearchEmbedding = require('../models/ProductSearchEmbedding');
const localEmbeddingService = require('./localEmbeddingService');
const {
  SEARCH_SEMANTIC_MAX_PRODUCTS,
  SEARCH_SEMANTIC_MIN_SCORE,
  isSemanticEnabled,
} = require('./productSemanticSearch/config');
const { buildFilter } = require('./productSemanticSearch/filter');
const {
  getStatus,
  reindexAllActiveProducts,
  removeProductEmbedding,
  upsertProductEmbedding,
} = require('./productSemanticSearch/embeddingOperations');
const {
  scoreCandidateProducts,
  searchProducts,
} = require('./productSemanticSearch/searchOperations');

/**
 * Semantic search and semantic indexing facade for product catalog.
 */
class ProductSemanticSearchService {
  /**
   * Returns whether semantic search is enabled.
   * @return {boolean} Enabled flag.
   */
  isEnabled() {
    return isSemanticEnabled(localEmbeddingService);
  }

  /**
   * Builds Mongo filter from semantic params.
   * @param {object} params Search params.
   * @return {object} Mongo filter.
   */
  buildFilter(params) {
    return buildFilter(params);
  }

  /**
   * Inserts or updates one product embedding.
   * @param {object} product Product payload.
   * @return {Promise<boolean>} True when index changed.
   */
  async upsertProductEmbedding(product) {
    return upsertProductEmbedding({
      product,
      isEnabled: () => this.isEnabled(),
      ProductSearchEmbedding,
      localEmbeddingService,
    });
  }

  /**
   * Removes one product embedding.
   * @param {string} productId Product id.
   * @return {Promise<void>} Completion promise.
   */
  async removeProductEmbedding(productId) {
    return removeProductEmbedding({
      productId,
      ProductSearchEmbedding,
    });
  }

  /**
   * Rebuilds semantic index for active products.
   * @return {Promise<object>} Reindex summary.
   */
  async reindexAllActiveProducts() {
    return reindexAllActiveProducts({
      isEnabled: () => this.isEnabled(),
      Product,
      localEmbeddingService,
      maxProducts: SEARCH_SEMANTIC_MAX_PRODUCTS,
      upsertFn: (product) => this.upsertProductEmbedding(product),
    });
  }

  /**
   * Returns semantic index status.
   * @return {Promise<object>} Status payload.
   */
  async getStatus() {
    return getStatus({
      isEnabled: () => this.isEnabled(),
      ProductSearchEmbedding,
      localEmbeddingService,
    });
  }

  /**
   * Scores known candidate ids with semantic similarity.
   * @param {{search: string, candidateProductIds: string[]}} params Score params.
   * @return {Promise<Map<string, number>>} Product id to score map.
   */
  async scoreCandidateProducts(params) {
    return scoreCandidateProducts(params, {
      isEnabled: () => this.isEnabled(),
      ProductSearchEmbedding,
      localEmbeddingService,
    });
  }

  /**
   * Searches products using semantic vectors.
   * @param {object} params Search params.
   * @return {Promise<object[]>} Ranked products.
   */
  async searchProducts(params) {
    return searchProducts(params, {
      isEnabled: () => this.isEnabled(),
      Product,
      ProductSearchEmbedding,
      localEmbeddingService,
      buildFilter: (filterParams) => this.buildFilter(filterParams),
      minScore: SEARCH_SEMANTIC_MIN_SCORE,
    });
  }
}

module.exports = new ProductSemanticSearchService();
