const { GoogleGenerativeAI } = require('@google/generative-ai');
const searchOperations = require('./semanticSearch/searchOperations');
const {
  embedText,
  fetchCatalogForIndex,
  isIndexFresh,
  loadIndexFromCache,
  rebuildIndex,
} = require('./semanticSearch/indexBuilder');
const {
  ensureIndex,
  forceReindex,
  invalidateIndex,
  scheduleReindex,
  startRebuild,
} = require('./semanticSearch/lifecycle');
const {
  getEmbeddingModel,
  getPublicStatus,
  isEnabled,
  markEmbeddingModelUnavailable,
} = require('./semanticSearch/availability');

/**
 * Manages semantic embedding index lifecycle and similarity search operations.
 */
class SemanticSearchService {
  constructor() {
    this.genAI = process.env.GEMINI_API_KEY
      ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      : null;
    this.embeddingModel = null;
    this.embeddingModelName = null;
    this.failedEmbeddingModels = new Set();
    this.embeddingModelsExhausted = false;

    this.index = {
      products: [],
      updatedAt: 0,
      source: 'cold_start',
      stats: {
        indexed: 0,
        skipped: 0,
        failed: 0,
      },
    };

    this.indexBuildPromise = null;
    this.reindexTimer = null;
    this.lastError = null;
  }

  /**
   * Returns whether semantic search is enabled.
   * @return {boolean} Enabled state.
   */
  isEnabled() {
    return isEnabled(this);
  }

  /**
   * Returns public semantic status payload.
   * @return {object} Status payload.
   */
  getPublicStatus() {
    return getPublicStatus(this);
  }

  /**
   * Returns active embedding model.
   * @return {object|null} Embedding model instance.
   */
  getEmbeddingModel() {
    return getEmbeddingModel(this);
  }

  /**
   * Marks active model as unavailable.
   * @param {string} modelName Failed model name.
   * @param {Error} error Failure reason.
   * @return {void} No return value.
   */
  markEmbeddingModelUnavailable(modelName, error) {
    markEmbeddingModelUnavailable(this, modelName, error);
  }

  /**
   * Loads index from cache if available.
   * @return {Promise<boolean>} True when cache load succeeded.
   */
  async loadIndexFromCache() {
    return loadIndexFromCache(this);
  }

  /**
   * Returns whether current index is fresh.
   * @return {boolean} True when index is fresh.
   */
  isIndexFresh() {
    return isIndexFresh(this);
  }

  /**
   * Fetches catalog source data for index build.
   * @param {number=} maxProducts Maximum products.
   * @return {Promise<object[]>} Source products.
   */
  async fetchCatalogForIndex(maxProducts) {
    return fetchCatalogForIndex(this, maxProducts);
  }

  /**
   * Embeds text with model-scoped cache.
   * @param {string} text Input text.
   * @param {string} cacheKey Cache key.
   * @param {number} ttlMs Cache ttl.
   * @return {Promise<{vector: number[]|null, cacheHit: boolean}>} Embedding payload.
   */
  async embedText(text, cacheKey, ttlMs) {
    return embedText(this, text, cacheKey, ttlMs);
  }

  /**
   * Rebuilds semantic index.
   * @param {string=} reason Build reason.
   * @return {Promise<object>} Status payload.
   */
  async rebuildIndex(reason) {
    return rebuildIndex(this, reason);
  }

  /**
   * Starts asynchronous rebuild.
   * @param {string=} reason Build reason.
   * @return {Promise<object>} Build promise.
   */
  startRebuild(reason) {
    return startRebuild(this, reason);
  }

  /**
   * Schedules asynchronous rebuild.
   * @param {string=} reason Build reason.
   * @return {void} No return value.
   */
  scheduleReindex(reason) {
    scheduleReindex(this, reason);
  }

  /**
   * Ensures index is available.
   * @param {{force?: boolean, waitForBuild?: boolean, reason?: string}=} options Ensure options.
   * @return {Promise<{ready: boolean, cacheHit: boolean, building: boolean}>} Ensure status.
   */
  async ensureIndex(options) {
    return ensureIndex(this, options);
  }

  /**
   * Forces rebuild and returns status.
   * @param {string=} reason Force rebuild reason.
   * @return {Promise<object>} Status payload.
   */
  async forceReindex(reason) {
    return forceReindex(this, reason);
  }

  /**
   * Invalidates index and schedules rebuild.
   * @param {string=} reason Invalidation reason.
   * @return {Promise<object>} Status payload.
   */
  async invalidateIndex(reason) {
    return invalidateIndex(this, reason);
  }

  /**
   * Applies filter predicates for semantic search candidates.
   * @param {object} product Product document.
   * @param {object} filters Filter options.
   * @return {boolean} True when product passes filters.
   */
  applyFilters(product, filters) {
    return searchOperations.applyFilters(product, filters);
  }

  /**
   * Runs semantic search and returns raw result payload.
   * @param {string} query Search query.
   * @param {object=} options Search options.
   * @return {Promise<object>} Search payload.
   */
  async search(query, options = {}) {
    return searchOperations.search(this, query, options);
  }

  /**
   * Runs semantic search and maps result to product list payload.
   * @param {string} query Search query.
   * @param {object=} options Search options.
   * @return {Promise<object>} Product result payload.
   */
  async searchProducts(query, options = {}) {
    return searchOperations.searchProducts(this, query, options);
  }

  /**
   * Finds similar products for a source product using vector similarity.
   * @param {string} productId Source product identifier.
   * @param {{
   *   limit?: number,
   *   minScore?: number,
   *   category?: string,
   *   minPrice?: number,
   *   maxPrice?: number,
   *   inStockOnly?: boolean,
   * }} options Optional filters and ranking controls.
   * @return {Promise<{
   *   results: Array<{
   *     productId: string,
   *     score: number,
   *     category: string|null,
   *     basePrice: number,
   *   }>,
   *   sourceCategory: string|null,
   *   cacheHit: boolean,
   *   semanticUsed: boolean,
   *   reason: string,
   *   error?: string,
   * }>} Similarity result payload.
   */
  async getSimilarProductsByProductId(productId, options = {}) {
    return searchOperations.getSimilarProductsByProductId(this, productId, options);
  }
}

module.exports = new SemanticSearchService();
