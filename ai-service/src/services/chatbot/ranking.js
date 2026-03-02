const { clamp, getTotalStock, sanitizeText } = require('./textUtils');
const { extractKeywordTokens } = require('./preferences');

/**
 * Creates ranking helpers for chatbot retrieval.
 * @param {{
 *   ProductScore: object,
 *   maxCandidateProducts: number,
 *   maxProductsInPrompt: number,
 * }} deps Ranking dependencies.
 * @return {{
 *   rerankProducts: (userMessage: string, products: object[], slots: object, semanticScoreMap?: Map<string, number>) => Promise<object[]>,
 *   buildCandidateContext: (products: object[]) => object[],
 *   mapRecommendationsToProducts: (recommendations: object[], productPool: object[]) => object[],
 * }} Ranking utilities.
 */
function createRankingTools(deps) {
  const {
    ProductScore,
    maxCandidateProducts,
    maxProductsInPrompt,
  } = deps;

  /**
   * Loads popularity signals from ProductScore records.
   * @param {object[]} products Candidate products.
   * @return {Promise<Map<string, {trendingNormalized: number, viewCount: number, purchaseCount: number}>>}
   *     Popularity signals by product id.
   */
  async function getPopularitySignalMap(products) {
    const ids = (products || []).map((product) => product.id).filter(Boolean);
    if (!ids.length) {
      return new Map();
    }

    try {
      const scores = await ProductScore.find({
        productId: { $in: ids },
      }).select('productId trendingScore viewCount purchaseCount').lean();

      const maxTrending = Math.max(1, ...scores.map((score) => score.trendingScore || 0));
      const signalMap = new Map();

      scores.forEach((score) => {
        signalMap.set(score.productId, {
          trendingNormalized: clamp((score.trendingScore || 0) / maxTrending, 0, 1),
          viewCount: score.viewCount || 0,
          purchaseCount: score.purchaseCount || 0,
        });
      });

      return signalMap;
    } catch (error) {
      console.warn('Failed to load popularity signals:', error.message);
      return new Map();
    }
  }

  /**
   * Scores one product against current query context.
   * @param {object} product Product payload.
   * @param {string} userMessage User message.
   * @param {object} slots Preference slots.
   * @param {object} popularitySignal Popularity signal payload.
   * @param {number} semanticScore Semantic relevance score.
   * @param {number} retrievalIndex Position in retrieval list.
   * @return {number} Composite score.
   */
  function scoreProduct(product, userMessage, slots, popularitySignal, semanticScore, retrievalIndex) {
    const haystack = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLowerCase();
    const tokens = extractKeywordTokens(userMessage, 12);

    let lexicalScore = 0;
    tokens.forEach((token) => {
      if (haystack.includes(token)) {
        lexicalScore += 1.5;
      }
      if ((product.name || '').toLowerCase().includes(token)) {
        lexicalScore += 1.25;
      }
      if ((product.category || '').toLowerCase().includes(token)) {
        lexicalScore += 0.8;
      }
    });

    let categoryScore = 0;
    if (slots?.category && String(product.category || '').toLowerCase() === String(slots.category).toLowerCase()) {
      categoryScore = 3;
    }

    let priceScore = 0;
    if (typeof slots?.minPrice === 'number' && product.basePrice >= slots.minPrice) {
      priceScore += 1;
    }
    if (typeof slots?.maxPrice === 'number' && product.basePrice <= slots.maxPrice) {
      priceScore += 1;
    }
    if (typeof slots?.minPrice !== 'number' && typeof slots?.maxPrice !== 'number') {
      priceScore += 0.4;
    }

    const totalStock = getTotalStock(product);
    const stockScore = slots?.inStockOnly
      ? (totalStock > 0 ? 2 : -5)
      : clamp(totalStock / 30, 0, 1.5);

    const popularityScore = clamp((popularitySignal?.trendingNormalized || 0) * 2.5, 0, 2.5);
    const semanticBonus = clamp((semanticScore || 0) * 4, 0, 4);

    const recencyScore = clamp(
      (Date.now() - new Date(product.createdAt || 0).getTime()) / (1000 * 60 * 60 * 24 * 30),
      0,
      2
    );
    const freshnessBonus = 2 - recencyScore;

    const retrievalOrderBonus = clamp((maxCandidateProducts - retrievalIndex) * 0.03, 0, 0.6);

    return lexicalScore
      + categoryScore
      + priceScore
      + stockScore
      + popularityScore
      + semanticBonus
      + freshnessBonus
      + retrievalOrderBonus;
  }

  /**
   * Re-ranks products using lexical, semantic, and popularity signals.
   * @param {string} userMessage User message.
   * @param {object[]} products Candidate products.
   * @param {object} slots Preference slots.
   * @param {Map<string, number>=} semanticScoreMap Semantic scores by product id.
   * @return {Promise<object[]>} Ranked products.
   */
  async function rerankProducts(userMessage, products, slots, semanticScoreMap = new Map()) {
    const popularitySignals = await getPopularitySignalMap(products);

    const scored = (products || []).map((product, index) => {
      const popularitySignal = popularitySignals.get(product.id);
      const semanticScore = semanticScoreMap.get(product.id) || 0;
      const score = scoreProduct(product, userMessage, slots, popularitySignal, semanticScore, index);
      return { product, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);
  }

  /**
   * Builds compact candidate context for model prompts.
   * @param {object[]} products Candidate products.
   * @return {object[]} Prompt-friendly product context.
   */
  function buildCandidateContext(products) {
    if (!products || products.length === 0) {
      return [];
    }

    return products.slice(0, maxProductsInPrompt).map((product) => {
      const totalStock = getTotalStock(product);
      return {
        productId: product.id,
        name: sanitizeText(product.name),
        category: sanitizeText(product.category),
        price: Number.parseFloat((product.basePrice || 0).toFixed(2)),
        stock: totalStock,
        description: sanitizeText(product.description).slice(0, 180),
      };
    });
  }

  /**
   * Maps model recommendations to concrete products.
   * @param {object[]} recommendations Recommendation objects.
   * @param {object[]} productPool Available products.
   * @return {object[]} Selected products.
   */
  function mapRecommendationsToProducts(recommendations, productPool) {
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      return [];
    }

    const byId = new Map((productPool || []).map((product) => [product.id, product]));
    const selected = [];

    recommendations.forEach((recommendation) => {
      const product = byId.get(recommendation.productId);
      if (product && !selected.find((entry) => entry.id === recommendation.productId)) {
        selected.push(product);
      }
    });

    return selected;
  }

  return {
    buildCandidateContext,
    mapRecommendationsToProducts,
    rerankProducts,
  };
}

module.exports = {
  createRankingTools,
};
