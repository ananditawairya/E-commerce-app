const {
  clamp,
  cosineSimilarityNormalized,
  normalizeStringArray,
  sanitizeText,
  toPublicProduct,
} = require('./helpers');

/**
 * Scores a known candidate set with semantic similarity.
 * @param {{
 *   search: string,
 *   candidateProductIds: string[],
 * }} params Candidate scoring params.
 * @param {{
 *   isEnabled: () => boolean,
 *   ProductSearchEmbedding: object,
 *   localEmbeddingService: object,
 * }} deps Dependencies.
 * @return {Promise<Map<string, number>>} Product id to score map.
 */
async function scoreCandidateProducts({ search, candidateProductIds }, deps) {
  const cleanSearch = sanitizeText(search);
  const {
    isEnabled,
    ProductSearchEmbedding,
    localEmbeddingService,
  } = deps;

  if (
    !cleanSearch
    || !isEnabled()
    || !Array.isArray(candidateProductIds)
    || candidateProductIds.length === 0
  ) {
    return new Map();
  }

  const normalizedIds = normalizeStringArray(candidateProductIds);
  if (normalizedIds.length === 0) {
    return new Map();
  }

  const queryVector = await localEmbeddingService.embedText(cleanSearch);
  if (!queryVector) {
    return new Map();
  }

  const embeddings = await ProductSearchEmbedding.find({
    productId: { $in: normalizedIds },
    isActive: true,
    embeddingModel: localEmbeddingService.getModelName(),
  })
    .select('+vector productId')
    .lean();

  const scores = new Map();
  for (const embedding of embeddings) {
    const score = cosineSimilarityNormalized(queryVector, embedding.vector);
    if (Number.isFinite(score)) {
      scores.set(embedding.productId, score);
    }
  }

  return scores;
}

/**
 * Executes semantic-first product search.
 * @param {{
 *   search?: string,
 *   category?: string,
 *   categories?: string[],
 *   minPrice?: number,
 *   maxPrice?: number,
 *   inStockOnly?: boolean,
 *   limit?: number,
 *   offset?: number,
 * }} params Search params.
 * @param {{
 *   isEnabled: () => boolean,
 *   Product: object,
 *   ProductSearchEmbedding: object,
 *   localEmbeddingService: object,
 *   buildFilter: Function,
 *   minScore: number,
 * }} deps Dependencies.
 * @return {Promise<object[]>} Ranked products.
 */
async function searchProducts(params, deps) {
  const cleanSearch = sanitizeText(params.search);
  const {
    isEnabled,
    Product,
    ProductSearchEmbedding,
    localEmbeddingService,
    buildFilter,
    minScore,
  } = deps;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  if (!cleanSearch || !isEnabled()) {
    return [];
  }

  const queryVector = await localEmbeddingService.embedText(cleanSearch);
  if (!queryVector) {
    return [];
  }

  const filter = buildFilter(params);
  const candidates = await Product.find(filter)
    .select('_id sellerId name description category basePrice images variants isActive createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(Math.max(limit + offset, 20) * 6)
    .lean();

  if (candidates.length === 0) {
    return [];
  }

  const candidateIds = candidates.map((product) => product._id);
  const embeddings = await ProductSearchEmbedding.find({
    productId: { $in: candidateIds },
    isActive: true,
    embeddingModel: localEmbeddingService.getModelName(),
  })
    .select('+vector productId')
    .lean();

  const vectorByProductId = new Map();
  embeddings.forEach((entry) => {
    vectorByProductId.set(entry.productId, entry.vector);
  });

  const scored = candidates
    .map((product) => {
      const vector = vectorByProductId.get(product._id);
      const score = cosineSimilarityNormalized(queryVector, vector);
      return {
        product,
        score,
      };
    })
    .filter((entry) => Number.isFinite(entry.score) && entry.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [];
  }

  const normalizedOffset = Math.max(0, offset);
  const normalizedLimit = clamp(limit, 1, 50);

  return scored
    .slice(normalizedOffset, normalizedOffset + normalizedLimit)
    .map((entry) => toPublicProduct(entry.product, entry.score));
}

module.exports = {
  scoreCandidateProducts,
  searchProducts,
};
