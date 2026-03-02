/**
 * Creates co-purchase and legacy similar-product strategy helpers.
 * @param {{
 *   ProductScore: object,
 *   UserBehavior: object,
 *   normalizeLimit: (value: unknown, fallback: number, max: number) => number,
 * }} deps Dependencies.
 * @return {{
 *   getMostRecentProductCategory: (productId: string) => Promise<string|null>,
 *   getCoPurchaseCandidates: (productId: string, limit?: number) => Promise<object[]>,
 *   getSimilarProductsLegacy: (productId: string, limit?: number, fallbackCategory?: string|null) => Promise<object[]>,
 * }} Strategy helpers.
 */
function createCoPurchaseStrategies(deps) {
  const {
    ProductScore,
    UserBehavior,
    normalizeLimit,
  } = deps;

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
   * @param {number=} limit Candidate pool limit.
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
   * Legacy similar-products fallback strategy.
   * @param {string} productId Product id.
   * @param {number=} limit Max recommendations.
   * @param {string|null=} fallbackCategory Optional source category.
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

  return {
    getCoPurchaseCandidates,
    getMostRecentProductCategory,
    getSimilarProductsLegacy,
  };
}

module.exports = {
  createCoPurchaseStrategies,
};
