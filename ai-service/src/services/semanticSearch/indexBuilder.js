const cacheService = require('../cacheService');
const {
  EMBEDDING_MODEL_CANDIDATES,
  INDEX_CACHE_KEY,
  SEMANTIC_INDEX_CACHE_TTL_MS,
  SEMANTIC_INDEX_STALE_MS,
  SEMANTIC_MAX_PRODUCTS,
  SEMANTIC_PAGE_SIZE,
  SEMANTIC_PRODUCT_EMBED_TTL_MS,
} = require('./config');
const {
  buildModelScopedCacheKey,
  buildProductDocumentText,
  createTextHash,
  executeProductServiceQuery,
  extractErrorMessage,
  getTotalStock,
  isEmbeddingModelUnavailableError,
  normalizeVector,
  sanitizeText,
} = require('./helpers');
const {
  getEmbeddingModel,
  getPublicStatus,
  isEnabled,
  markEmbeddingModelUnavailable,
} = require('./availability');

/**
 * Loads semantic index from cache into service state.
 * @param {object} service SemanticSearchService instance.
 * @return {Promise<boolean>} True when cache load succeeded.
 */
async function loadIndexFromCache(service) {
  const cachedIndex = await cacheService.getJson(INDEX_CACHE_KEY);
  if (!cachedIndex || !Array.isArray(cachedIndex.products) || cachedIndex.products.length === 0) {
    return false;
  }

  service.index = {
    products: cachedIndex.products,
    updatedAt: Number.parseInt(cachedIndex.updatedAt || '0', 10) || 0,
    source: cachedIndex.source || 'cache',
    stats: cachedIndex.stats || {
      indexed: cachedIndex.products.length,
      skipped: 0,
      failed: 0,
    },
  };

  return true;
}

/**
 * Returns whether in-memory index is still considered fresh.
 * @param {object} service SemanticSearchService instance.
 * @return {boolean} True when index is fresh.
 */
function isIndexFresh(service) {
  if (!service.index.updatedAt || service.index.products.length === 0) {
    return false;
  }

  return Date.now() - service.index.updatedAt < SEMANTIC_INDEX_STALE_MS;
}

/**
 * Fetches product catalog pages used for index build.
 * @param {object} service SemanticSearchService instance.
 * @param {number=} maxProducts Maximum products.
 * @return {Promise<object[]>} Products for indexing.
 */
async function fetchCatalogForIndex(service, maxProducts = SEMANTIC_MAX_PRODUCTS) {
  const query = `
    query ProductsForSemanticIndex(
      $limit: Int
      $offset: Int
      $sortBy: ProductSortBy
    ) {
      products(
        limit: $limit
        offset: $offset
        sortBy: $sortBy
        inStockOnly: false
      ) {
        id
        name
        description
        category
        basePrice
        images
        createdAt
        updatedAt
        variants {
          id
          name
          priceModifier
          effectivePrice
          stock
        }
      }
    }
  `;

  let offset = 0;
  const all = [];

  while (all.length < maxProducts) {
    const pageLimit = Math.min(SEMANTIC_PAGE_SIZE, maxProducts - all.length);
    if (pageLimit <= 0) {
      break;
    }

    const data = await executeProductServiceQuery(query, {
      limit: pageLimit,
      offset,
      sortBy: 'NEWEST',
    });

    const page = Array.isArray(data.products) ? data.products : [];
    if (page.length === 0) {
      break;
    }

    all.push(...page);

    if (page.length < pageLimit) {
      break;
    }

    offset += page.length;
  }

  const deduped = new Map();
  all.forEach((product) => {
    if (product?.id && !deduped.has(product.id)) {
      deduped.set(product.id, product);
    }
  });

  return Array.from(deduped.values()).slice(0, maxProducts);
}

/**
 * Embeds text using active model with model-scoped cache.
 * @param {object} service SemanticSearchService instance.
 * @param {string} text Input text.
 * @param {string} cacheKey Base cache key.
 * @param {number} ttlMs Cache ttl.
 * @return {Promise<{vector: number[]|null, cacheHit: boolean}>} Embedding payload.
 */
async function embedText(service, text, cacheKey, ttlMs) {
  const normalizedText = sanitizeText(text).slice(0, 1200);
  if (!normalizedText || !isEnabled(service)) {
    return {
      vector: null,
      cacheHit: false,
    };
  }

  const maxModelAttempts = Math.max(1, EMBEDDING_MODEL_CANDIDATES.length);

  for (let attempt = 0; attempt < maxModelAttempts; attempt += 1) {
    const model = getEmbeddingModel(service);
    const activeModelName = service.embeddingModelName;
    if (!model || !activeModelName) {
      break;
    }

    const scopedCacheKey = buildModelScopedCacheKey(cacheKey, activeModelName);
    if (scopedCacheKey) {
      const cached = await cacheService.getJson(scopedCacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        return {
          vector: cached,
          cacheHit: true,
        };
      }
    }

    try {
      const result = await model.embedContent(normalizedText);

      const rawValues =
        result?.embedding?.values ||
        result?.embedding?.value ||
        result?.embeddings?.[0]?.values ||
        result?.embeddings?.[0]?.values ||
        null;

      const vector = normalizeVector(rawValues);

      if (!vector) {
        return {
          vector: null,
          cacheHit: false,
        };
      }

      if (scopedCacheKey) {
        await cacheService.setJson(scopedCacheKey, vector, ttlMs);
      }

      return {
        vector,
        cacheHit: false,
      };
    } catch (error) {
      if (isEmbeddingModelUnavailableError(error)) {
        markEmbeddingModelUnavailable(service, activeModelName, error);
        continue;
      }
      throw error;
    }
  }

  return {
    vector: null,
    cacheHit: false,
  };
}

/**
 * Rebuilds semantic index from live catalog.
 * @param {object} service SemanticSearchService instance.
 * @param {string=} reason Build reason.
 * @return {Promise<object>} Public status after rebuild.
 */
async function rebuildIndex(service, reason = 'manual') {
  if (!isEnabled(service)) {
    return getPublicStatus(service);
  }

  const products = await fetchCatalogForIndex(service);
  if (products.length === 0) {
    throw new Error('No products available to build semantic index');
  }

  const indexedProducts = [];
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    const content = buildProductDocumentText(product);
    if (!content) {
      skipped += 1;
      continue;
    }

    try {
      const versionTag = sanitizeText(product.updatedAt || product.createdAt || 'na');
      const productEmbedKey = `ai:semantic:prod:${product.id}:${createTextHash(versionTag)}`;
      const { vector } = await embedText(
        service,
        content,
        productEmbedKey,
        SEMANTIC_PRODUCT_EMBED_TTL_MS
      );

      if (!vector) {
        skipped += 1;
        continue;
      }

      indexedProducts.push({
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        basePrice: product.basePrice,
        images: product.images,
        variants: product.variants,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        totalStock: getTotalStock(product),
        vector,
      });
    } catch (error) {
      failed += 1;
      console.warn(`Semantic embedding failed for product ${product?.id}:`, extractErrorMessage(error));
    }
  }

  if (indexedProducts.length === 0) {
    throw new Error('Semantic index build produced 0 embedded products');
  }

  service.index = {
    products: indexedProducts,
    updatedAt: Date.now(),
    source: reason,
    stats: {
      indexed: indexedProducts.length,
      skipped,
      failed,
    },
  };

  await cacheService.setJson(INDEX_CACHE_KEY, service.index, SEMANTIC_INDEX_CACHE_TTL_MS);
  service.lastError = null;

  return getPublicStatus(service);
}

module.exports = {
  embedText,
  fetchCatalogForIndex,
  isIndexFresh,
  loadIndexFromCache,
  rebuildIndex,
};
