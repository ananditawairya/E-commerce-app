const {
  SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE,
  SIMILAR_PRODUCTS_SIGNAL_WEIGHTS,
} = require('./constants');
const {
  clamp,
  computeCategorySimilarity,
  normalizeByMax,
  normalizeLimit,
} = require('./scoringUtils');

/**
 * Builds recommendation strategy functions.
 * @param {{
 *   UserBehavior: object,
 *   ProductScore: object,
 *   semanticSearchService: object,
 * }} deps Shared dependencies.
 * @return {object} Strategy method map.
 */
function createRecommendationStrategies(deps) {
  const {
    UserBehavior,
    ProductScore,
    semanticSearchService,
  } = deps;

  /**
   * Collaborative filtering strategy.
   * @param {string} userId User id.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async function getCollaborativeRecommendations(userId, limit = 5) {
    const userPurchases = await UserBehavior.find({
      userId,
      eventType: 'purchase',
    }).distinct('productId');

    if (userPurchases.length === 0) {
      return [];
    }

    const similarUsers = await UserBehavior.find({
      productId: { $in: userPurchases },
      eventType: 'purchase',
      userId: { $ne: userId },
    }).distinct('userId');

    if (similarUsers.length === 0) {
      return [];
    }

    const recommendations = await UserBehavior.aggregate([
      {
        $match: {
          userId: { $in: similarUsers },
          eventType: 'purchase',
          productId: { $nin: userPurchases },
        },
      },
      {
        $group: {
          _id: '$productId',
          score: { $sum: 1 },
          category: { $first: '$category' },
        },
      },
      { $sort: { score: -1 } },
      { $limit: limit },
    ]);

    return recommendations.map((row) => ({
      productId: row._id,
      score: row.score,
      reason: 'Customers who bought similar products also bought this',
      category: row.category,
    }));
  }

  /**
   * Content-based category strategy.
   * @param {string} userId User id.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async function getContentBasedRecommendations(userId, limit = 5) {
    const userCategories = await UserBehavior.aggregate([
      {
        $match: {
          userId,
          eventType: { $in: ['view', 'purchase', 'cart_add'] },
          category: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$category',
          score: {
            $sum: {
              $switch: {
                branches: [
                  { case: { $eq: ['$eventType', 'purchase'] }, then: 5 },
                  { case: { $eq: ['$eventType', 'cart_add'] }, then: 3 },
                  { case: { $eq: ['$eventType', 'view'] }, then: 1 },
                ],
                default: 1,
              },
            },
          },
        },
      },
      { $sort: { score: -1 } },
      { $limit: 3 },
    ]);

    if (userCategories.length === 0) {
      return [];
    }

    const categories = userCategories.map((entry) => entry._id);
    const userProducts = await UserBehavior.find({ userId }).distinct('productId');
    const recommendations = await ProductScore.find({
      category: { $in: categories },
      productId: { $nin: userProducts },
    })
      .sort({ trendingScore: -1 })
      .limit(limit);

    return recommendations.map((row) => ({
      productId: row.productId,
      score: row.trendingScore,
      reason: `Popular in ${row.category}`,
      category: row.category,
    }));
  }

  /**
   * Fetches inferred category for one product.
   * @param {string} productId Product id.
   * @return {Promise<string|null>} Category value.
   */
  async function getMostRecentProductCategory(productId) {
    const latestBehavior = await UserBehavior.findOne({
      productId,
      category: { $nin: [null, ''] },
    })
      .sort({ createdAt: -1 })
      .select('category')
      .lean();

    if (latestBehavior?.category) {
      return latestBehavior.category;
    }

    const scoreDoc = await ProductScore.findOne({ productId })
      .select('category')
      .lean();
    return scoreDoc?.category || null;
  }

  /**
   * Finds co-purchase candidate pool.
   * @param {string} productId Product id.
   * @param {number} limit Candidate pool limit.
   * @return {Promise<object[]>} Candidate list.
   */
  async function getCoPurchaseCandidates(productId, limit = 40) {
    const poolLimit = normalizeLimit(limit, 40, 200);
    const rows = await UserBehavior.aggregate([
      {
        $match: {
          productId,
          eventType: 'purchase',
        },
      },
      { $group: { _id: '$userId' } },
      {
        $lookup: {
          from: 'userbehaviors',
          let: { buyerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$buyerId'] },
                    { $eq: ['$eventType', 'purchase'] },
                    { $ne: ['$productId', productId] },
                  ],
                },
              },
            },
          ],
          as: 'otherPurchases',
        },
      },
      { $unwind: '$otherPurchases' },
      {
        $group: {
          _id: '$otherPurchases.productId',
          buyerIds: { $addToSet: '$_id' },
          category: { $first: '$otherPurchases.category' },
        },
      },
      {
        $project: {
          category: 1,
          buyerCount: { $size: '$buyerIds' },
        },
      },
      { $sort: { buyerCount: -1 } },
      { $limit: poolLimit },
    ]);

    return rows.map((row) => ({
      productId: row._id,
      category: row.category || null,
      buyerCount: Number(row.buyerCount) || 0,
    }));
  }

  /**
   * Hybrid similar-products strategy.
   * @param {string} productId Product id.
   * @param {number} limit Max recommendations.
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

  /**
   * Legacy similar-products fallback strategy.
   * @param {string} productId Product id.
   * @param {number} limit Max recommendations.
   * @param {string|null} fallbackCategory Optional source category.
   * @return {Promise<object[]>} Recommendation list.
   */
  async function getSimilarProductsLegacy(productId, limit = 10, fallbackCategory = null) {
    const normalizedLimit = normalizeLimit(limit, 10, 50);
    const category = fallbackCategory || await getMostRecentProductCategory(productId);

    const coPurchased = await UserBehavior.aggregate([
      {
        $match: {
          productId,
          eventType: 'purchase',
        },
      },
      {
        $lookup: {
          from: 'userbehaviors',
          let: { buyerId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$buyerId'] },
                    { $eq: ['$eventType', 'purchase'] },
                    { $ne: ['$productId', productId] },
                  ],
                },
              },
            },
          ],
          as: 'otherPurchases',
        },
      },
      { $unwind: '$otherPurchases' },
      {
        $group: {
          _id: '$otherPurchases.productId',
          score: { $sum: 1 },
          category: { $first: '$otherPurchases.category' },
        },
      },
      { $sort: { score: -1 } },
      { $limit: Math.ceil(normalizedLimit / 2) },
    ]);

    const recommendations = coPurchased.map((row) => ({
      productId: row._id,
      score: row.score * 2,
      reason: 'Frequently bought together',
      category: row.category,
    }));

    if (recommendations.length < normalizedLimit && category) {
      const existingIds = recommendations.map((row) => row.productId);
      existingIds.push(productId);

      const sameCategoryProducts = await ProductScore.find({
        category,
        productId: { $nin: existingIds },
      })
        .sort({ trendingScore: -1 })
        .limit(normalizedLimit - recommendations.length);

      for (const product of sameCategoryProducts) {
        recommendations.push({
          productId: product.productId,
          score: product.trendingScore,
          reason: `Similar product in ${category}`,
          category: product.category,
        });
      }
    }

    return recommendations.slice(0, normalizedLimit);
  }

  /**
   * Fetches trending products globally or by category.
   * @param {string|null} category Optional category.
   * @param {number} limit Max recommendations.
   * @return {Promise<object[]>} Recommendation list.
   */
  async function getTrendingProducts(category = null, limit = 10) {
    const query = category ? { category } : {};
    const trending = await ProductScore.find(query)
      .sort({ trendingScore: -1 })
      .limit(limit);

    return trending.map((product) => ({
      productId: product.productId,
      score: product.trendingScore,
      reason: category ? `Trending in ${category}` : 'Trending now',
      category: product.category,
    }));
  }

  /**
   * Fetches the most recently viewed unique products for a user.
   * @param {string} userId User id.
   * @param {number} limit Max items.
   * @return {Promise<object[]>} Recently viewed items.
   */
  async function getRecentlyViewed(userId, limit = 10) {
    const recentViews = await UserBehavior.find({
      userId,
      eventType: 'view',
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    const seen = new Set();
    const unique = [];
    for (const view of recentViews) {
      if (!seen.has(view.productId)) {
        seen.add(view.productId);
        unique.push({
          productId: view.productId,
          score: 1,
          reason: 'Recently viewed',
          category: view.category,
        });
      }
    }

    return unique;
  }

  return {
    getCollaborativeRecommendations,
    getContentBasedRecommendations,
    getCoPurchaseCandidates,
    getHybridSimilarProducts,
    getMostRecentProductCategory,
    getRecentlyViewed,
    getSimilarProductsLegacy,
    getTrendingProducts,
  };
}

module.exports = {
  createRecommendationStrategies,
};
