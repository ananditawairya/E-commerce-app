const {
  SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE,
  SIMILAR_PRODUCTS_SIGNAL_WEIGHTS,
} = require('../constants');
const {
  clamp,
  computeCategorySimilarity,
  normalizeByMax,
  normalizeLimit,
} = require('../scoringUtils');
const { createCoPurchaseStrategies } = require('./similarity/coPurchaseStrategies');

/**
 * Creates similar-products strategy helpers.
 * @param {{
 *   ProductScore: object,
 *   UserBehavior: object,
 *   semanticSearchService: object,
 * }} deps Dependencies.
 * @return {{
 *   getMostRecentProductCategory: (productId: string) => Promise<string|null>,
 *   getCoPurchaseCandidates: (productId: string, limit?: number) => Promise<object[]>,
 *   getHybridSimilarProducts: (productId: string, limit?: number) => Promise<object[]>,
 *   getSimilarProductsLegacy: (productId: string, limit?: number, fallbackCategory?: string|null) => Promise<object[]>,
 * }} Strategy map.
 */
function createSimilarityStrategies(deps) {
  const {
    ProductScore,
    UserBehavior,
    semanticSearchService,
  } = deps;

  const {
    getCoPurchaseCandidates,
    getMostRecentProductCategory,
    getSimilarProductsLegacy,
  } = createCoPurchaseStrategies({
    ProductScore,
    UserBehavior,
    normalizeLimit,
  });

  /**
   * Hybrid similar-products strategy.
   * @param {string} productId Product id.
   * @param {number=} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async function getHybridSimilarProducts(productId, limit = 10) {
    const normalizedLimit = normalizeLimit(limit, 10, 50);
    const candidatePoolLimit = Math.max(normalizedLimit * 6, 30);

    let semanticResult = {
      results: [],
      sourceCategory: null,
      semanticUsed: false,
      reason: 'not_attempted',
    };

    try {
      semanticResult = await semanticSearchService.getSimilarProductsByProductId(
        productId,
        {
          limit: candidatePoolLimit,
          minScore: SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE,
          inStockOnly: false,
        }
      );
    } catch (error) {
      console.warn('Semantic similar-products lookup failed:', error.message);
    }

    const sourceCategory = semanticResult.sourceCategory
      || await getMostRecentProductCategory(productId);

    const semanticByProductId = new Map();
    for (const semanticEntry of semanticResult.results || []) {
      semanticByProductId.set(semanticEntry.productId, {
        score: Number(semanticEntry.score) || 0,
        category: semanticEntry.category || null,
      });
    }

    const coPurchaseCandidates = await getCoPurchaseCandidates(productId, candidatePoolLimit);
    const maxCoPurchaseCount = coPurchaseCandidates.reduce((maxCount, candidate) => {
      return Math.max(maxCount, Number(candidate.buyerCount) || 0);
    }, 0);

    const candidateByProductId = new Map();
    const addCandidate = (candidateProductId, category = null) => {
      if (!candidateProductId || candidateProductId === productId) {
        return;
      }

      const existing = candidateByProductId.get(candidateProductId) || {
        productId: candidateProductId,
        category: null,
        coPurchaseRaw: 0,
      };

      if (!existing.category && category) {
        existing.category = category;
      }
      candidateByProductId.set(candidateProductId, existing);
    };

    for (const [candidateProductId, semanticEntry] of semanticByProductId.entries()) {
      addCandidate(candidateProductId, semanticEntry.category);
    }

    for (const coPurchaseCandidate of coPurchaseCandidates) {
      addCandidate(coPurchaseCandidate.productId, coPurchaseCandidate.category);
      const existing = candidateByProductId.get(coPurchaseCandidate.productId);
      existing.coPurchaseRaw = Number(coPurchaseCandidate.buyerCount) || 0;
    }

    if (sourceCategory) {
      const categoryTrendingCandidates = await ProductScore.find({
        category: sourceCategory,
        productId: { $ne: productId },
      })
        .sort({ trendingScore: -1 })
        .limit(candidatePoolLimit)
        .select('productId category trendingScore')
        .lean();

      categoryTrendingCandidates.forEach((candidate) => {
        addCandidate(candidate.productId, candidate.category || sourceCategory);
      });
    }

    if (candidateByProductId.size === 0) {
      return [];
    }

    const productIds = Array.from(candidateByProductId.keys());
    const productScores = await ProductScore.find({
      productId: { $in: productIds },
    })
      .select('productId category trendingScore')
      .lean();

    const scoreByProductId = new Map();
    let maxTrendingScore = 0;
    productScores.forEach((scoreDoc) => {
      scoreByProductId.set(scoreDoc.productId, scoreDoc);
      maxTrendingScore = Math.max(maxTrendingScore, Number(scoreDoc.trendingScore) || 0);
    });

    const ranked = productIds.map((candidateProductId) => {
      const candidate = candidateByProductId.get(candidateProductId);
      const semanticSignal = semanticByProductId.get(candidateProductId);
      const scoreDoc = scoreByProductId.get(candidateProductId);

      const category = scoreDoc?.category
        || candidate.category
        || semanticSignal?.category
        || null;

      const embeddingScore = clamp(Number(semanticSignal?.score) || 0, 0, 1);
      const categoryScore = computeCategorySimilarity(sourceCategory, category);
      const coPurchaseScore = normalizeByMax(candidate.coPurchaseRaw, maxCoPurchaseCount);
      const popularityScore = normalizeByMax(
        Number(scoreDoc?.trendingScore) || 0,
        maxTrendingScore
      );

      const finalScore = (embeddingScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.embedding)
        + (categoryScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.category)
        + (coPurchaseScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.coPurchase)
        + (popularityScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.popularity);

      let reason = 'Similar product';
      if (embeddingScore >= Math.max(categoryScore, coPurchaseScore, popularityScore)) {
        reason = 'Similar by embedding';
      } else if (categoryScore >= Math.max(coPurchaseScore, popularityScore)) {
        reason = category ? `Similar in ${category}` : 'Similar category';
      } else if (coPurchaseScore >= popularityScore) {
        reason = 'Frequently bought together';
      } else {
        reason = 'Popular similar product';
      }

      return {
        productId: candidateProductId,
        score: Number(finalScore.toFixed(4)),
        reason,
        category,
      };
    });

    return ranked
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, normalizedLimit);
  }

  return {
    getCoPurchaseCandidates,
    getHybridSimilarProducts,
    getMostRecentProductCategory,
    getSimilarProductsLegacy,
  };
}

module.exports = {
  createSimilarityStrategies,
};
