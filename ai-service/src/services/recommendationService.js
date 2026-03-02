const UserBehavior = require('../models/UserBehavior');
const ProductScore = require('../models/ProductScore');
const semanticSearchService = require('./semanticSearchService');
const {
  EVENT_TYPE_ALIASES,
  VALID_EVENT_TYPES,
} = require('./recommendation/constants');
const { normalizeLimit } = require('./recommendation/scoringUtils');
const { createRecommendationStrategies } = require('./recommendation/strategies');

/**
 * Recommendation service orchestration.
 */
class RecommendationService {
  constructor() {
    this.deps = {
      ProductScore,
      UserBehavior,
      semanticSearchService,
    };
    this.strategies = createRecommendationStrategies(this.deps);
  }

  /**
   * Normalizes raw event type values.
   * @param {unknown} eventType Event type input.
   * @return {string|null} Normalized event type or null.
   */
  normalizeEventType(eventType) {
    if (typeof eventType !== 'string') {
      return null;
    }

    const normalized = eventType.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return EVENT_TYPE_ALIASES[normalized] || normalized;
  }

  /**
   * Checks if an event type is supported.
   * @param {string} eventType Event type.
   * @return {boolean} True when supported.
   */
  isValidEventType(eventType) {
    return VALID_EVENT_TYPES.has(eventType);
  }

  /**
   * Returns allowed event type list.
   * @return {string[]} Valid event types.
   */
  getValidEventTypes() {
    return Array.from(VALID_EVENT_TYPES);
  }

  /**
   * Persists user behavior and updates product scoring.
   * @param {string} userId User identifier.
   * @param {string} productId Product identifier.
   * @param {string} eventType Event type.
   * @param {string|null} category Product category.
   * @param {object} metadata Event metadata.
   * @return {Promise<boolean>} True when saved.
   */
  async trackEvent(userId, productId, eventType, category = null, metadata = {}) {
    try {
      const normalizedEventType = this.normalizeEventType(eventType);
      if (!this.isValidEventType(normalizedEventType)) {
        const error = new Error(
          `Invalid eventType "${eventType}". Valid types: ${this.getValidEventTypes().join(', ')}`
        );
        error.code = 'INVALID_EVENT_TYPE';
        throw error;
      }

      const behavior = new UserBehavior({
        userId,
        productId,
        eventType: normalizedEventType,
        category,
        metadata,
      });
      await behavior.save();
      await this.updateProductScore(productId, normalizedEventType, category);
      return true;
    } catch (error) {
      console.error('Error tracking event:', error);
      throw error;
    }
  }

  /**
   * Updates aggregated product popularity counters.
   * @param {string} productId Product identifier.
   * @param {string} eventType Normalized event type.
   * @param {string|null} category Product category.
   * @return {Promise<void>} Completion promise.
   */
  async updateProductScore(productId, eventType, category = null) {
    const updateFields = { lastInteraction: new Date() };
    const incrementFields = {};

    switch (eventType) {
      case 'view':
        incrementFields.viewCount = 1;
        break;
      case 'purchase':
        incrementFields.purchaseCount = 1;
        break;
      case 'cart_add':
        incrementFields.cartAddCount = 1;
        break;
      default:
        break;
    }

    await ProductScore.findOneAndUpdate(
      { productId },
      {
        $set: { ...updateFields, category },
        $inc: incrementFields,
      },
      { upsert: true, new: true }
    );

    await this.recalculateTrendingScore(productId);
  }

  /**
   * Recomputes weighted trending score.
   * @param {string} productId Product identifier.
   * @return {Promise<void>} Completion promise.
   */
  async recalculateTrendingScore(productId) {
    const score = await ProductScore.findOne({ productId });
    if (!score) {
      return;
    }

    const trendingScore = (score.viewCount * 1)
      + (score.cartAddCount * 3)
      + (score.purchaseCount * 5);

    await ProductScore.updateOne(
      { productId },
      { $set: { trendingScore } }
    );
  }

  /**
   * Gets personalized recommendations using blended strategies.
   * @param {string} userId User identifier.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async getRecommendations(userId, limit = 10) {
    const recommendations = [];

    try {
      const collaborativeRecs = await this.getCollaborativeRecommendations(
        userId,
        Math.ceil(limit / 2)
      );
      const contentRecs = await this.getContentBasedRecommendations(
        userId,
        Math.ceil(limit / 2)
      );

      const seen = new Set();
      for (const rec of [...collaborativeRecs, ...contentRecs]) {
        if (!seen.has(rec.productId)) {
          seen.add(rec.productId);
          recommendations.push(rec);
        }
      }

      return recommendations.slice(0, limit);
    } catch (error) {
      console.error('Error getting recommendations:', error);
      return [];
    }
  }

  /**
   * Collaborative filtering strategy wrapper.
   * @param {string} userId User identifier.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  getCollaborativeRecommendations(userId, limit = 5) {
    return this.strategies.getCollaborativeRecommendations(userId, limit);
  }

  /**
   * Content-based strategy wrapper.
   * @param {string} userId User identifier.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  getContentBasedRecommendations(userId, limit = 5) {
    return this.strategies.getContentBasedRecommendations(userId, limit);
  }

  /**
   * Returns inferred category for one product.
   * @param {string} productId Product identifier.
   * @return {Promise<string|null>} Category value.
   */
  getMostRecentProductCategory(productId) {
    return this.strategies.getMostRecentProductCategory(productId);
  }

  /**
   * Returns co-purchase candidate pool.
   * @param {string} productId Product identifier.
   * @param {number} limit Candidate limit.
   * @return {Promise<object[]>} Candidate list.
   */
  getCoPurchaseCandidates(productId, limit = 40) {
    return this.strategies.getCoPurchaseCandidates(productId, limit);
  }

  /**
   * Gets similar products with hybrid ranking.
   * @param {string} productId Product identifier.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  getHybridSimilarProducts(productId, limit = 10) {
    return this.strategies.getHybridSimilarProducts(productId, limit);
  }

  /**
   * Gets similar products using legacy fallback ranking.
   * @param {string} productId Product identifier.
   * @param {number} limit Max recommendations.
   * @param {string|null} fallbackCategory Optional category.
   * @return {Promise<object[]>} Recommendation list.
   */
  getSimilarProductsLegacy(productId, limit = 10, fallbackCategory = null) {
    return this.strategies.getSimilarProductsLegacy(
      productId,
      limit,
      fallbackCategory
    );
  }

  /**
   * Gets similar products with hybrid then legacy fallback.
   * @param {string} productId Product identifier.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async getSimilarProducts(productId, limit = 10) {
    const normalized = normalizeLimit(limit, 10, 50);

    try {
      const hybridRecommendations = await this.getHybridSimilarProducts(
        productId,
        normalized
      );

      if (hybridRecommendations.length > 0) {
        return hybridRecommendations;
      }

      const categoryFallback = await this.getMostRecentProductCategory(productId);
      return this.getSimilarProductsLegacy(productId, normalized, categoryFallback);
    } catch (error) {
      console.error('Error getting similar products:', error);
      try {
        const categoryFallback = await this.getMostRecentProductCategory(productId);
        return this.getSimilarProductsLegacy(productId, normalized, categoryFallback);
      } catch (fallbackError) {
        console.error('Error getting fallback similar products:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Gets trending products globally or by category.
   * @param {string|null} category Optional category.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async getTrendingProducts(category = null, limit = 10) {
    try {
      return await this.strategies.getTrendingProducts(category, limit);
    } catch (error) {
      console.error('Error getting trending products:', error);
      return [];
    }
  }

  /**
   * Gets recent unique viewed products for one user.
   * @param {string} userId User identifier.
   * @param {number} limit Max products.
   * @return {Promise<object[]>} Recommendation list.
   */
  async getRecentlyViewed(userId, limit = 10) {
    try {
      return await this.strategies.getRecentlyViewed(userId, limit);
    } catch (error) {
      console.error('Error getting recently viewed:', error);
      return [];
    }
  }
}

module.exports = new RecommendationService();
