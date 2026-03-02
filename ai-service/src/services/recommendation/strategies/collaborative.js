/**
 * Creates collaborative/content recommendation strategies.
 * @param {{UserBehavior: object, ProductScore: object}} deps Dependencies.
 * @return {{
 *   getCollaborativeRecommendations: (userId: string, limit?: number) => Promise<object[]>,
 *   getContentBasedRecommendations: (userId: string, limit?: number) => Promise<object[]>,
 *   getTrendingProducts: (category?: string|null, limit?: number) => Promise<object[]>,
 *   getRecentlyViewed: (userId: string, limit?: number) => Promise<object[]>,
 * }} Strategy map.
 */
function createCollaborativeStrategies(deps) {
  const { UserBehavior, ProductScore } = deps;

  /**
   * Collaborative filtering strategy.
   * @param {string} userId User id.
   * @param {number=} limit Max recommendations.
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
   * @param {number=} limit Max recommendations.
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
   * Fetches trending products globally or by category.
   * @param {string|null=} category Optional category.
   * @param {number=} limit Max recommendations.
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
   * Fetches most recent unique views for user.
   * @param {string} userId User id.
   * @param {number=} limit Max items.
   * @return {Promise<object[]>} Recently viewed products.
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
    getRecentlyViewed,
    getTrendingProducts,
  };
}

module.exports = {
  createCollaborativeStrategies,
};
