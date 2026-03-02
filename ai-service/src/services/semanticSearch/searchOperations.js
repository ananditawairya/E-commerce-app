const {
  SEMANTIC_MIN_SCORE,
  SEMANTIC_QUERY_EMBED_TTL_MS,
  SEMANTIC_SEARCH_TIMEOUT_MS,
} = require('./config');
const {
  clamp,
  cosineSimilarityNormalized,
  createTextHash,
  extractErrorMessage,
  lexicalOverlapBoost,
  sanitizeText,
  withTimeout,
} = require('./helpers');

/**
 * Applies runtime product filters.
 * @param {object} product Indexed product.
 * @param {object} filters Filter payload.
 * @return {boolean} True when product matches.
 */
function applyFilters(product, filters) {
  if (!product) {
    return false;
  }

  const {
    category,
    minPrice,
    maxPrice,
    inStockOnly,
  } = filters;

  if (category && sanitizeText(product.category).toLowerCase() !== sanitizeText(category).toLowerCase()) {
    return false;
  }

  if (Number.isFinite(minPrice) && Number.isFinite(product.basePrice) && product.basePrice < minPrice) {
    return false;
  }

  if (Number.isFinite(maxPrice) && Number.isFinite(product.basePrice) && product.basePrice > maxPrice) {
    return false;
  }

  if (inStockOnly && (!Number.isFinite(product.totalStock) || product.totalStock <= 0)) {
    return false;
  }

  return true;
}

/**
 * Executes semantic search over in-memory index.
 * @param {object} service SemanticSearchService instance.
 * @param {string} query Search query.
 * @param {object} options Search options.
 * @return {Promise<object>} Search result payload.
 */
async function search(service, query, options = {}) {
  const cleanQuery = sanitizeText(query);
  const limit = Number.parseInt(options.limit || '12', 10);

  if (!service.isEnabled() || !cleanQuery) {
    return {
      products: [],
      semanticUsed: false,
      cacheHit: false,
      reason: 'disabled_or_empty',
    };
  }

  try {
    const indexState = await service.ensureIndex({
      force: false,
      waitForBuild: false,
      reason: 'search',
    });

    if (!indexState.ready || service.index.products.length === 0) {
      return {
        products: [],
        semanticUsed: false,
        cacheHit: false,
        reason: 'index_warming',
      };
    }

    const queryEmbedKey = `ai:semantic:q:${createTextHash(cleanQuery.toLowerCase())}`;
    const queryEmbedding = await withTimeout(
      service.embedText(cleanQuery, queryEmbedKey, SEMANTIC_QUERY_EMBED_TTL_MS),
      SEMANTIC_SEARCH_TIMEOUT_MS,
      'Semantic query embedding timeout'
    );

    if (!queryEmbedding.vector) {
      return {
        products: [],
        semanticUsed: false,
        cacheHit: queryEmbedding.cacheHit,
        reason: 'query_embedding_failed',
      };
    }

    const minScore = Number.isFinite(options.minScore) ? options.minScore : SEMANTIC_MIN_SCORE;
    const candidates = [];

    service.index.products.forEach((product) => {
      if (!applyFilters(product, options)) {
        return;
      }

      const semanticScore = cosineSimilarityNormalized(queryEmbedding.vector, product.vector);
      const lexicalBoost = lexicalOverlapBoost(cleanQuery, product);
      const stockBoost = clamp((product.totalStock || 0) / 80, 0, 0.15);
      const hybridScore = (semanticScore * 0.82) + (lexicalBoost * 0.14) + stockBoost;

      if (hybridScore < minScore) {
        return;
      }

      candidates.push({
        product,
        score: hybridScore,
      });
    });

    const normalizedLimit = Number.isFinite(limit) ? clamp(limit, 1, 30) : 12;
    const top = candidates
      .sort((left, right) => right.score - left.score)
      .slice(0, normalizedLimit)
      .map((entry) => {
        const base = {
          id: entry.product.id,
          name: entry.product.name,
          description: entry.product.description,
          category: entry.product.category,
          basePrice: entry.product.basePrice,
          images: entry.product.images,
          variants: entry.product.variants,
          createdAt: entry.product.createdAt,
        };

        if (options.includeScores) {
          base.semanticScore = Number(entry.score.toFixed(4));
        }

        return base;
      });

    return {
      products: top,
      semanticUsed: true,
      cacheHit: Boolean(indexState.cacheHit && queryEmbedding.cacheHit),
      reason: 'ok',
    };
  } catch (error) {
    const errorMessage = error?.message || 'unknown error';
    service.lastError = {
      message: errorMessage,
      at: new Date().toISOString(),
      reason: 'search',
    };

    console.warn('Semantic search failed:', errorMessage);
    return {
      products: [],
      semanticUsed: false,
      cacheHit: false,
      reason: 'error',
      error: errorMessage,
    };
  }
}

/**
 * Returns compact semantic search product-score tuples.
 * @param {object} service SemanticSearchService instance.
 * @param {string} query Search query.
 * @param {object} options Search options.
 * @return {Promise<object>} Semantic results.
 */
async function searchProducts(service, query, options = {}) {
  const semantic = await search(service, query, {
    ...options,
    includeScores: true,
  });

  const results = (semantic.products || []).map((product) => ({
    productId: product.id,
    score: Number.isFinite(product.semanticScore) ? product.semanticScore : 0,
  }));

  return {
    results,
    cacheHit: semantic.cacheHit,
    semanticUsed: semantic.semanticUsed,
    reason: semantic.reason,
    error: semantic.error,
  };
}

/**
 * Finds similar products from source product embedding.
 * @param {object} service SemanticSearchService instance.
 * @param {string} productId Source product id.
 * @param {object} options Similarity options.
 * @return {Promise<object>} Similar products payload.
 */
async function getSimilarProductsByProductId(service, productId, options = {}) {
  const cleanProductId = sanitizeText(productId);
  const limit = Number.parseInt(options.limit || '30', 10);

  if (!cleanProductId) {
    return {
      results: [],
      sourceCategory: null,
      cacheHit: false,
      semanticUsed: false,
      reason: 'empty_product_id',
    };
  }

  if (!service.isEnabled()) {
    return {
      results: [],
      sourceCategory: null,
      cacheHit: false,
      semanticUsed: false,
      reason: 'disabled',
    };
  }

  try {
    const indexState = await service.ensureIndex({
      force: false,
      waitForBuild: false,
      reason: 'similar_products',
    });

    if (!indexState.ready || service.index.products.length === 0) {
      return {
        results: [],
        sourceCategory: null,
        cacheHit: false,
        semanticUsed: false,
        reason: 'index_warming',
      };
    }

    const sourceProduct = service.index.products.find(
      (product) => String(product.id) === cleanProductId
    );

    if (!sourceProduct || !Array.isArray(sourceProduct.vector) || sourceProduct.vector.length === 0) {
      return {
        results: [],
        sourceCategory: sourceProduct?.category || null,
        cacheHit: false,
        semanticUsed: false,
        reason: 'source_not_indexed',
      };
    }

    const minScore = Number.isFinite(options.minScore) ? options.minScore : 0;
    const normalizedLimit = Number.isFinite(limit) ? clamp(limit, 1, 200) : 30;
    const candidates = [];

    service.index.products.forEach((product) => {
      if (String(product.id) === cleanProductId) {
        return;
      }

      if (!applyFilters(product, options)) {
        return;
      }

      const rawCosine = cosineSimilarityNormalized(sourceProduct.vector, product.vector);
      const normalizedCosine = clamp((rawCosine + 1) / 2, 0, 1);
      if (normalizedCosine < minScore) {
        return;
      }

      candidates.push({
        productId: product.id,
        score: Number(normalizedCosine.toFixed(6)),
        category: product.category || null,
        basePrice: Number.isFinite(product.basePrice) ? product.basePrice : 0,
      });
    });

    return {
      results: candidates
        .sort((left, right) => right.score - left.score)
        .slice(0, normalizedLimit),
      sourceCategory: sourceProduct.category || null,
      cacheHit: Boolean(indexState.cacheHit),
      semanticUsed: true,
      reason: 'ok',
    };
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    service.lastError = {
      message: errorMessage,
      at: new Date().toISOString(),
      reason: 'similar_products',
    };

    return {
      results: [],
      sourceCategory: null,
      cacheHit: false,
      semanticUsed: false,
      reason: 'error',
      error: errorMessage,
    };
  }
}

module.exports = {
  applyFilters,
  getSimilarProductsByProductId,
  search,
  searchProducts,
};
