const { v4: uuidv4 } = require('uuid');

const Product = require('../models/Product');
const kafkaProducer = require('../kafka/kafkaProducer');
const { sanitizeProductInput } = require('../utils/inputSanitizer');
const cacheService = require('./cacheService');
const productSemanticSearchService = require('./productSemanticSearchService');
const searchEngineService = require('./searchEngineService');
const catalogOperations = require('./productService/catalogOperations');
const mutationOperations = require('./productService/mutationOperations');
const inventoryOperations = require('./productService/inventoryOperations');

/**
 * Orchestrates product-service domain operations.
 */
class ProductService {
  constructor() {
    this.deps = {
      Product,
      kafkaProducer,
      sanitizeProductInput,
      cacheService,
      productSemanticSearchService,
      searchEngineService,
      uuidGenerator: uuidv4,
    };
  }

  /**
   * Fetches product listings with filters and pagination.
   * @param {object} params Query filters.
   * @return {Promise<object[]>} Product list.
   */
  getProducts(params) {
    return catalogOperations.getProducts(this.deps, params);
  }

  /**
   * Fetches one product by id.
   * @param {string} id Product id.
   * @return {Promise<object>} Product document.
   */
  getProductById(id) {
    return catalogOperations.getProductById(this.deps, id);
  }

  /**
   * Fetches all products belonging to one seller.
   * @param {string} sellerId Seller id.
   * @return {Promise<object[]>} Product list.
   */
  getProductsBySeller(sellerId) {
    return catalogOperations.getProductsBySeller(this.deps, sellerId);
  }

  /**
   * Fetches distinct category names.
   * @return {Promise<string[]>} Category list.
   */
  getCategories() {
    return catalogOperations.getCategories(this.deps);
  }

  /**
   * Fetches search-as-you-type suggestions.
   * @param {{
   *   query: string,
   *   limit?: number,
   *   categories?: string[],
   * }} params Suggestion params.
   * @return {Promise<Array<{text: string, category: string|null, score: number|null, source: string}>>}
   *     Suggestion list.
   */
  getSearchSuggestions(params) {
    return catalogOperations.getSearchSuggestions(this.deps, params);
  }

  /**
   * Retrieves semantic search index status.
   * @return {Promise<object>} Status payload.
   */
  getSemanticSearchStatus() {
    return catalogOperations.getSemanticSearchStatus(this.deps);
  }

  /**
   * Triggers semantic search reindex.
   * @return {Promise<object>} Reindex summary.
   */
  reindexSemanticSearch() {
    return catalogOperations.reindexSemanticSearch(this.deps);
  }

  /**
   * Creates a product.
   * @param {string} sellerId Seller id.
   * @param {object} input Product payload.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object>} Created product.
   */
  createProduct(sellerId, input, correlationId) {
    return mutationOperations.createProduct(this.deps, sellerId, input, correlationId);
  }

  /**
   * Updates a product.
   * @param {string} productId Product id.
   * @param {string} sellerId Seller id.
   * @param {object} input Product payload.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object>} Updated product.
   */
  updateProduct(productId, sellerId, input, correlationId) {
    return mutationOperations.updateProduct(
      this.deps,
      productId,
      sellerId,
      input,
      correlationId
    );
  }

  /**
   * Deletes a seller-owned product.
   * @param {string} productId Product id.
   * @param {string} sellerId Seller id.
   * @return {Promise<boolean>} True when deleted.
   */
  deleteProduct(productId, sellerId) {
    return mutationOperations.deleteProduct(this.deps, productId, sellerId);
  }

  /**
   * Reserves stock for a pending order.
   * @param {string} productId Product id.
   * @param {string} variantId Variant id.
   * @param {number} quantity Quantity.
   * @param {string} orderId Order id.
   * @param {number} reservationTimeoutMs Reservation timeout in milliseconds.
   * @param {string} correlationId Correlation id.
   * @return {Promise<object>} Reservation details.
   */
  reserveStock(
    productId,
    variantId,
    quantity,
    orderId,
    reservationTimeoutMs = 300000,
    correlationId
  ) {
    return inventoryOperations.reserveStock(
      this.deps,
      productId,
      variantId,
      quantity,
      orderId,
      reservationTimeoutMs,
      correlationId
    );
  }

  /**
   * Confirms a stock reservation.
   * @param {string} productId Product id.
   * @param {string} variantId Variant id.
   * @param {string} reservationId Reservation id.
   * @param {string} orderId Order id.
   * @param {string} correlationId Correlation id.
   * @return {Promise<boolean>} True when confirmed.
   */
  confirmReservation(productId, variantId, reservationId, orderId, correlationId) {
    return inventoryOperations.confirmReservation(
      this.deps,
      productId,
      variantId,
      reservationId,
      orderId,
      correlationId
    );
  }

  /**
   * Releases a pending reservation.
   * @param {string} productId Product id.
   * @param {string} variantId Variant id.
   * @param {string} reservationId Reservation id.
   * @param {string} correlationId Correlation id.
   * @return {Promise<boolean>} True when released.
   */
  releaseReservation(productId, variantId, reservationId, correlationId) {
    return inventoryOperations.releaseReservation(
      this.deps,
      productId,
      variantId,
      reservationId,
      correlationId
    );
  }

  /**
   * Deducts stock.
   * @param {string} productId Product id.
   * @param {string} variantId Variant id.
   * @param {number} quantity Quantity.
   * @param {string} orderId Order id.
   * @param {string} correlationId Correlation id.
   * @return {Promise<boolean>} True when deducted.
   */
  deductStock(productId, variantId, quantity, orderId, correlationId) {
    return inventoryOperations.deductStock(
      this.deps,
      productId,
      variantId,
      quantity,
      orderId,
      correlationId
    );
  }

  /**
   * Restores stock.
   * @param {string} productId Product id.
   * @param {string} variantId Variant id.
   * @param {number} quantity Quantity.
   * @param {string} orderId Order id.
   * @param {string} correlationId Correlation id.
   * @param {string=} variantName Variant name fallback.
   * @return {Promise<boolean>} True when restored.
   */
  restoreStock(productId, variantId, quantity, orderId, correlationId, variantName) {
    return inventoryOperations.restoreStock(
      this.deps,
      productId,
      variantId,
      quantity,
      orderId,
      correlationId,
      variantName
    );
  }

  /**
   * Retrieves current stock details.
   * @param {string} productId Product id.
   * @param {string=} variantId Variant id.
   * @return {Promise<object>} Stock payload.
   */
  getProductStock(productId, variantId) {
    return inventoryOperations.getProductStock(this.deps, productId, variantId);
  }
}

module.exports = new ProductService();
