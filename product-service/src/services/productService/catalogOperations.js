/**
 * Product catalog read operations.
 */

const MAX_QUERY_LIMIT = 50;
const DEFAULT_QUERY_LIMIT = 20;
const DEFAULT_SUGGESTION_LIMIT = 8;
const MAX_SUGGESTION_LIMIT = 20;
const CATALOG_NAMESPACE = 'catalog';
const DEFAULT_CATALOG_CACHE_TTL_MS = Number.parseInt(
  process.env.PRODUCT_CATALOG_CACHE_TTL_MS || '120000',
  10
);
const DEFAULT_SUGGESTION_CACHE_TTL_MS = Number.parseInt(
  process.env.PRODUCT_SUGGESTION_CACHE_TTL_MS || '45000',
  10
);
const SEARCH_SUGGESTION_ENABLE_SEMANTIC_FALLBACK = String(
  process.env.PRODUCT_SUGGESTION_ENABLE_SEMANTIC_FALLBACK || 'true'
).toLowerCase() === 'true';
const RELEVANCE_CANDIDATE_MULTIPLIER = Number.parseInt(
  process.env.PRODUCT_RELEVANCE_CANDIDATE_MULTIPLIER || '6',
  10
);
const RELEVANCE_MIN_CANDIDATES = Number.parseInt(
  process.env.PRODUCT_RELEVANCE_MIN_CANDIDATES || '40',
  10
);
const RELEVANCE_MAX_CANDIDATES = Number.parseInt(
  process.env.PRODUCT_RELEVANCE_MAX_CANDIDATES || '300',
  10
);
const RELEVANCE_LEXICAL_WEAK_THRESHOLD = Number.parseInt(
  process.env.PRODUCT_RELEVANCE_LEXICAL_WEAK_THRESHOLD || '4',
  10
);

/**
 * Escapes regex special characters.
 * @param {string} input Raw value.
 * @return {string} Escaped value.
 */
function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes an array of string values.
 * @param {unknown} values Potential string array.
 * @return {string[]} Deduplicated, trimmed values.
 */
function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

/**
 * Creates a stable JSON string.
 * @param {unknown} value Input value.
 * @return {string} Deterministic JSON string.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * Builds a MongoDB query sort definition.
 * @param {string} sortBy Requested sort value.
 * @param {boolean} hasTextSearch Whether text search is applied.
 * @return {{
 *   sortConfig: object,
 *   useCaseInsensitiveCollation: boolean,
 *   useTextScoreProjection: boolean,
 * }} Sort options.
 */
function resolveSortOptions(sortBy, hasTextSearch) {
  let sortConfig = { createdAt: -1 };
  let useCaseInsensitiveCollation = false;
  let useTextScoreProjection = false;

  switch (sortBy) {
    case 'RELEVANCE':
      if (hasTextSearch) {
        sortConfig = { score: { $meta: 'textScore' }, createdAt: -1 };
        useTextScoreProjection = true;
      }
      break;
    case 'PRICE_LOW_TO_HIGH':
      sortConfig = { basePrice: 1, createdAt: -1 };
      break;
    case 'PRICE_HIGH_TO_LOW':
      sortConfig = { basePrice: -1, createdAt: -1 };
      break;
    case 'NAME_A_TO_Z':
      sortConfig = { name: 1, createdAt: -1 };
      useCaseInsensitiveCollation = true;
      break;
    case 'NAME_Z_TO_A':
      sortConfig = { name: -1, createdAt: -1 };
      useCaseInsensitiveCollation = true;
      break;
    case 'NEWEST':
    default:
      break;
  }

  return {
    sortConfig,
    useCaseInsensitiveCollation,
    useTextScoreProjection,
  };
}

/**
 * Applies optional price bounds in-place on a query object.
 * @param {object} query Mongo query object.
 * @param {number|undefined} minPrice Minimum price.
 * @param {number|undefined} maxPrice Maximum price.
 * @return {void} No return value.
 */
function applyPriceFilter(query, minPrice, maxPrice) {
  const hasMinPrice = Number.isFinite(minPrice);
  const hasMaxPrice = Number.isFinite(maxPrice);
  if (!hasMinPrice && !hasMaxPrice) {
    return;
  }

  let safeMin = hasMinPrice ? Math.max(minPrice, 0) : undefined;
  let safeMax = hasMaxPrice ? Math.max(maxPrice, 0) : undefined;
  if (hasMinPrice && hasMaxPrice && safeMin > safeMax) {
    [safeMin, safeMax] = [safeMax, safeMin];
  }

  query.basePrice = {};
  if (Number.isFinite(safeMin)) {
    query.basePrice.$gte = safeMin;
  }
  if (Number.isFinite(safeMax)) {
    query.basePrice.$lte = safeMax;
  }
}

/**
 * Clamps a number into a min/max range.
 * @param {number} value Input value.
 * @param {number} min Minimum.
 * @param {number} max Maximum.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts unknown value to finite number.
 * @param {unknown} value Input value.
 * @param {number} fallback Fallback value.
 * @return {number} Number value.
 */
function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Extracts product identifier.
 * @param {object} product Product payload.
 * @return {string|null} Product id.
 */
function getProductId(product) {
  if (!product || typeof product !== 'object') {
    return null;
  }

  const candidate = product.id || product._id;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate;
  }

  if (typeof candidate === 'number') {
    return String(candidate);
  }

  return null;
}

/**
 * Computes total in-stock quantity.
 * @param {object} product Product payload.
 * @return {number} Total stock.
 */
function getTotalStock(product) {
  if (!Array.isArray(product?.variants)) {
    return 0;
  }

  return product.variants.reduce((sum, variant) => (
    sum + Math.max(0, toFiniteNumber(variant?.stock, 0))
  ), 0);
}

/**
 * Derives sales and CTR signals from product payload.
 * @param {object} product Product payload.
 * @return {{sales: number, ctr: number}} Sales and ctr raw values.
 */
function getSalesAndCtr(product) {
  const sales = Math.max(
    0,
    toFiniteNumber(
      product?.salesCount,
      toFiniteNumber(
        product?.purchaseCount,
        toFiniteNumber(product?.totalSold, 0)
      )
    )
  );
  const explicitCtr = toFiniteNumber(product?.ctr, NaN);
  if (Number.isFinite(explicitCtr)) {
    return {
      sales,
      ctr: Math.max(0, explicitCtr),
    };
  }

  const viewCount = Math.max(
    0,
    toFiniteNumber(product?.viewCount, toFiniteNumber(product?.impressions, 0))
  );
  const ctr = viewCount > 0 ? sales / viewCount : 0;
  return {
    sales,
    ctr: Math.max(0, ctr),
  };
}

/**
 * Builds normalized signal maps for hybrid ranking.
 * @param {Array<{product: object, lexicalScore: number, semanticScore: number}>} entries
 *     Candidate entries.
 * @return {{
 *   lexicalMax: number,
 *   stockMax: number,
 *   salesMax: number,
 *   ctrMax: number,
 * }} Max values for normalization.
 */
function getSignalMaxValues(entries) {
  let lexicalMax = 0;
  let stockMax = 0;
  let salesMax = 0;
  let ctrMax = 0;

  entries.forEach((entry) => {
    lexicalMax = Math.max(lexicalMax, Math.max(0, toFiniteNumber(entry.lexicalScore, 0)));
    stockMax = Math.max(stockMax, getTotalStock(entry.product));
    const { sales, ctr } = getSalesAndCtr(entry.product);
    salesMax = Math.max(salesMax, sales);
    ctrMax = Math.max(ctrMax, ctr);
  });

  return {
    lexicalMax,
    stockMax,
    salesMax,
    ctrMax,
  };
}

/**
 * Creates normalized hybrid relevance score.
 * @param {{
 *   lexicalScore: number,
 *   semanticScore: number,
 *   stock: number,
 *   sales: number,
 *   ctr: number,
 * }} raw Raw signal values.
 * @param {{
 *   lexicalMax: number,
 *   stockMax: number,
 *   salesMax: number,
 *   ctrMax: number,
 * }} maxValues Normalization maxima.
 * @return {number} Final hybrid score.
 */
function scoreHybridResult(raw, maxValues) {
  const lexicalNormalized = maxValues.lexicalMax > 0
    ? clamp(raw.lexicalScore / maxValues.lexicalMax, 0, 1)
    : 0;
  const semanticNormalized = clamp(raw.semanticScore, 0, 1);
  const stockNormalized = maxValues.stockMax > 0
    ? clamp(raw.stock / maxValues.stockMax, 0, 1)
    : 0;
  const salesNormalized = maxValues.salesMax > 0
    ? clamp(raw.sales / maxValues.salesMax, 0, 1)
    : 0;
  const ctrNormalized = maxValues.ctrMax > 0
    ? clamp(raw.ctr / maxValues.ctrMax, 0, 1)
    : 0;

  // Hybrid weighting:
  // - Semantic and lexical carry the strongest relevance signal.
  // - Business signals (stock, sales, ctr) stabilize ranking quality.
  return (
    (semanticNormalized * 0.5) +
    (lexicalNormalized * 0.3) +
    (stockNormalized * 0.1) +
    (salesNormalized * 0.07) +
    (ctrNormalized * 0.03)
  );
}

/**
 * Merges two candidate arrays by product id.
 * @param {object[]} primary Primary candidate list.
 * @param {object[]} secondary Secondary candidate list.
 * @return {object[]} Merged deduplicated list.
 */
function mergeCandidates(primary, secondary) {
  const merged = new Map();

  [...primary, ...secondary].forEach((product) => {
    const productId = getProductId(product);
    if (!productId) {
      return;
    }

    const existing = merged.get(productId);
    if (!existing) {
      merged.set(productId, product);
      return;
    }

    const existingSemantic = toFiniteNumber(existing.semanticScore, 0);
    const nextSemantic = toFiniteNumber(product.semanticScore, 0);
    if (nextSemantic > existingSemantic) {
      merged.set(productId, {
        ...existing,
        ...product,
        score: Number.isFinite(existing.score) ? existing.score : product.score,
      });
    } else {
      merged.set(productId, {
        ...product,
        ...existing,
        semanticScore: Math.max(existingSemantic, nextSemantic),
      });
    }
  });

  return [...merged.values()];
}

/**
 * Re-ranks candidate products using semantic + lexical + business signals.
 * @param {{
 *   productSemanticSearchService: object,
 * }} deps Dependencies.
 * @param {{
 *   search: string,
 *   candidates: object[],
 *   limit: number,
 *   offset: number,
 * }} params Re-rank params.
 * @return {Promise<object[]>} Re-ranked products.
 */
async function rerankCandidates(deps, params) {
  const { productSemanticSearchService } = deps;
  const { search, candidates, limit, offset } = params;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const semanticScoresById = new Map();
  const candidateIds = candidates
    .map((candidate) => getProductId(candidate))
    .filter(Boolean);

  if (
    typeof search === 'string'
    && search.trim()
    && productSemanticSearchService
    && typeof productSemanticSearchService.isEnabled === 'function'
    && typeof productSemanticSearchService.scoreCandidateProducts === 'function'
    && productSemanticSearchService.isEnabled()
  ) {
    try {
      const semanticScores = await productSemanticSearchService.scoreCandidateProducts({
        search,
        candidateProductIds: candidateIds,
      });
      semanticScores.forEach((score, productId) => {
        semanticScoresById.set(productId, score);
      });
    } catch (error) {
      console.warn('Semantic reranking failed, using lexical/business ranking:', error.message);
    }
  }

  const entries = candidates.map((product) => {
    const productId = getProductId(product);
    const lexicalScore = Math.max(0, toFiniteNumber(product?.score, 0));
    const semanticScore = Math.max(
      0,
      toFiniteNumber(
        semanticScoresById.get(productId),
        toFiniteNumber(product?.semanticScore, 0)
      )
    );
    const stock = getTotalStock(product);
    const { sales, ctr } = getSalesAndCtr(product);

    return {
      product,
      lexicalScore,
      semanticScore,
      stock,
      sales,
      ctr,
    };
  });

  const signalMaxValues = getSignalMaxValues(entries);
  const ranked = entries
    .map((entry) => ({
      ...entry,
      finalScore: scoreHybridResult({
        lexicalScore: entry.lexicalScore,
        semanticScore: entry.semanticScore,
        stock: entry.stock,
        sales: entry.sales,
        ctr: entry.ctr,
      }, signalMaxValues),
    }))
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }
      return new Date(right.product.createdAt || 0).getTime()
        - new Date(left.product.createdAt || 0).getTime();
    });

  return ranked
    .slice(offset, offset + limit)
    .map((entry) => entry.product);
}

/**
 * Reads namespace version with safe fallback.
 * @param {object|undefined} cacheService Cache service.
 * @param {string} namespace Namespace name.
 * @return {Promise<number>} Namespace version.
 */
async function getNamespaceVersion(cacheService, namespace) {
  if (!cacheService || typeof cacheService.getNamespaceVersion !== 'function') {
    return 1;
  }

  try {
    return await cacheService.getNamespaceVersion(namespace);
  } catch (error) {
    console.warn('Failed to read cache namespace version:', error.message);
    return 1;
  }
}

/**
 * Executes cache-aside flow when cache service is available.
 * @template T
 * @param {object|undefined} cacheService Cache service.
 * @param {string} key Cache key.
 * @param {number} ttlMs Base TTL.
 * @param {() => Promise<T>} fetcher Source fetcher.
 * @return {Promise<T>} Resolved value.
 */
async function withOptionalCache(cacheService, key, ttlMs, fetcher) {
  if (!cacheService || typeof cacheService.withCacheAside !== 'function') {
    return fetcher();
  }

  const { value } = await cacheService.withCacheAside({
    key,
    baseTtlMs: ttlMs,
    fetcher,
  });
  return value;
}

/**
 * Fetches products using lexical and semantic search strategies.
 * @param {{
 *   Product: object,
 *   productSemanticSearchService: object,
 * }} deps Dependencies.
 * @param {{
 *   search: string,
 *   category: string,
 *   categories: string[],
 *   minPrice?: number,
 *   maxPrice?: number,
 *   inStockOnly?: boolean,
 *   sortBy: string,
 *   limit: number,
 *   offset: number,
 * }} params Normalized query filters.
 * @return {Promise<object[]>} Products.
 */
async function fetchProductsUncached(deps, params) {
  const {
    Product,
    productSemanticSearchService,
  } = deps;
  const {
    search,
    category,
    categories,
    minPrice,
    maxPrice,
    inStockOnly,
    sortBy,
    limit,
    offset,
  } = params;

  const query = { isActive: true };
  if (search) {
    query.$text = { $search: search };
  }

  if (categories.length > 0) {
    query.category = { $in: categories };
  } else if (category) {
    query.category = category;
  }

  if (inStockOnly === true) {
    query['variants.stock'] = { $gt: 0 };
  }

  applyPriceFilter(query, minPrice, maxPrice);

  if (search && sortBy === 'RELEVANCE') {
    const candidateLimit = clamp(
      (limit + offset) * Math.max(1, RELEVANCE_CANDIDATE_MULTIPLIER),
      Math.max(10, RELEVANCE_MIN_CANDIDATES),
      Math.max(RELEVANCE_MIN_CANDIDATES, RELEVANCE_MAX_CANDIDATES)
    );
    const semanticEnabled = Boolean(
      productSemanticSearchService
      && typeof productSemanticSearchService.isEnabled === 'function'
      && productSemanticSearchService.isEnabled()
    );

    let lexicalCandidates = [];
    try {
      lexicalCandidates = await Product.find(query, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(candidateLimit)
        .lean();
    } catch (error) {
      console.warn('Lexical relevance search failed:', error.message);
    }

    if (!semanticEnabled) {
      return rerankCandidates(deps, {
        search,
        candidates: lexicalCandidates,
        limit,
        offset,
      });
    }

    const lexicalIsWeak = lexicalCandidates.length < Math.max(1, RELEVANCE_LEXICAL_WEAK_THRESHOLD);
    if (!lexicalIsWeak) {
      return rerankCandidates(deps, {
        search,
        candidates: lexicalCandidates,
        limit,
        offset,
      });
    }

    try {
      const semanticCandidates = await productSemanticSearchService.searchProducts({
        search,
        category: category || undefined,
        categories: categories.length > 0 ? categories : undefined,
        minPrice,
        maxPrice,
        inStockOnly,
        limit: candidateLimit,
        offset: 0,
      });
      const mergedCandidates = mergeCandidates(lexicalCandidates, semanticCandidates);
      return rerankCandidates(deps, {
        search,
        candidates: mergedCandidates,
        limit,
        offset,
      });
    } catch (error) {
      console.warn(
        'Semantic fallback failed, returning lexical relevance results:',
        error.message
      );
      return rerankCandidates(deps, {
        search,
        candidates: lexicalCandidates,
        limit,
        offset,
      });
    }
  }

  const {
    sortConfig,
    useCaseInsensitiveCollation,
    useTextScoreProjection,
  } = resolveSortOptions(sortBy, Boolean(query.$text));

  let productQuery = useTextScoreProjection
    ? Product.find(query, { score: { $meta: 'textScore' } })
    : Product.find(query);

  productQuery = productQuery
    .sort(sortConfig)
    .limit(limit)
    .skip(offset);

  if (useCaseInsensitiveCollation) {
    productQuery = productQuery.collation({ locale: 'en', strength: 2 });
  }

  return productQuery.lean();
}

/**
 * Fetches products with filters and cache-aside.
 * @param {{
 *   Product: object,
 *   cacheService?: object,
 *   productSemanticSearchService: object,
 * }} deps Dependencies.
 * @param {{
 *   search?: string,
 *   category?: string,
 *   categories?: string[],
 *   minPrice?: number,
 *   maxPrice?: number,
 *   inStockOnly?: boolean,
 *   sortBy?: string,
 *   limit?: number,
 *   offset?: number,
 * }} params Query filters.
 * @return {Promise<object[]>} Products.
 */
async function getProducts(deps, params) {
  const { cacheService } = deps;
  const {
    search,
    category,
    categories,
    minPrice,
    maxPrice,
    inStockOnly,
    sortBy,
    limit = DEFAULT_QUERY_LIMIT,
    offset = 0,
  } = params;

  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  const normalizedCategory = typeof category === 'string' ? category.trim() : '';
  const normalizedCategories = normalizeStringArray(categories);
  const normalizedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(limit, 1), MAX_QUERY_LIMIT)
    : DEFAULT_QUERY_LIMIT;
  const normalizedOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;
  const resolvedSortBy = sortBy || (normalizedSearch ? 'RELEVANCE' : 'NEWEST');

  const normalizedParams = {
    search: normalizedSearch,
    category: normalizedCategory,
    categories: normalizedCategories,
    minPrice,
    maxPrice,
    inStockOnly,
    sortBy: resolvedSortBy,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };

  const namespaceVersion = await getNamespaceVersion(cacheService, CATALOG_NAMESPACE);
  const cacheKey = `product:catalog:v${namespaceVersion}:${stableStringify(normalizedParams)}`;

  return withOptionalCache(
    cacheService,
    cacheKey,
    DEFAULT_CATALOG_CACHE_TTL_MS,
    () => fetchProductsUncached(deps, normalizedParams)
  );
}

/**
 * Fetches one product by id with cache-aside.
 * @param {{Product: object, cacheService?: object}} deps Dependencies.
 * @param {string} id Product identifier.
 * @return {Promise<object>} Product document.
 */
async function getProductById({ Product, cacheService }, id) {
  const namespaceVersion = await getNamespaceVersion(cacheService, CATALOG_NAMESPACE);
  const cacheKey = `product:detail:v${namespaceVersion}:${id}`;

  return withOptionalCache(
    cacheService,
    cacheKey,
    DEFAULT_CATALOG_CACHE_TTL_MS,
    async () => {
      const product = await Product.findById(id).lean();
      if (!product) {
        const error = new Error('Product not found');
        error.code = 'PRODUCT_NOT_FOUND';
        throw error;
      }
      return product;
    }
  );
}

/**
 * Fetches products for one seller with cache-aside.
 * @param {{Product: object, cacheService?: object}} deps Dependencies.
 * @param {string} sellerId Seller identifier.
 * @return {Promise<object[]>} Product list.
 */
async function getProductsBySeller({ Product, cacheService }, sellerId) {
  const namespaceVersion = await getNamespaceVersion(cacheService, CATALOG_NAMESPACE);
  const cacheKey = `product:seller:v${namespaceVersion}:${sellerId}`;
  return withOptionalCache(
    cacheService,
    cacheKey,
    DEFAULT_CATALOG_CACHE_TTL_MS,
    () => Product.find({ sellerId }).sort({ createdAt: -1 }).lean()
  );
}

/**
 * Fetches distinct product categories with cache-aside.
 * @param {{Product: object, cacheService?: object}} deps Dependencies.
 * @return {Promise<string[]>} Category list.
 */
async function getCategories({ Product, cacheService }) {
  const namespaceVersion = await getNamespaceVersion(cacheService, CATALOG_NAMESPACE);
  const cacheKey = `product:categories:v${namespaceVersion}`;
  return withOptionalCache(
    cacheService,
    cacheKey,
    DEFAULT_CATALOG_CACHE_TTL_MS,
    async () => {
      const categories = await Product.distinct('category');
      return categories
        .filter((value) => typeof value === 'string' && value.trim())
        .sort((left, right) => left.localeCompare(right));
    }
  );
}

/**
 * Fetches search suggestions with dedicated engine fallback.
 * @param {{
 *   Product: object,
 *   cacheService?: object,
 *   searchEngineService?: object,
 * }} deps Dependencies.
 * @param {{
 *   query: string,
 *   categories?: string[],
 *   limit?: number,
 * }} params Suggestion params.
 * @return {Promise<Array<{text: string, category: string|null, score: number|null, source: string}>>}
 *     Suggestions.
 */
async function getSearchSuggestions(deps, params) {
  const {
    Product,
    cacheService,
    searchEngineService,
    productSemanticSearchService,
  } = deps;
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query) {
    return [];
  }

  const categories = normalizeStringArray(params.categories);
  const limit = Number.isFinite(params.limit)
    ? Math.min(Math.max(params.limit, 1), MAX_SUGGESTION_LIMIT)
    : DEFAULT_SUGGESTION_LIMIT;

  const namespaceVersion = await getNamespaceVersion(cacheService, CATALOG_NAMESPACE);
  const cacheKey = `product:suggestions:v${namespaceVersion}:${stableStringify({
    query,
    categories,
    limit,
  })}`;

  return withOptionalCache(
    cacheService,
    cacheKey,
    DEFAULT_SUGGESTION_CACHE_TTL_MS,
    async () => {
      if (searchEngineService && searchEngineService.isEnabled()) {
        try {
          const engineSuggestions = await searchEngineService.searchSuggestions({
            query,
            categories,
            limit,
          });
          if (engineSuggestions.length > 0) {
            return engineSuggestions;
          }
        } catch (error) {
          console.warn('Dedicated search suggestion query failed:', error.message);
        }
      }

      const escapedQuery = escapeRegExp(query);
      const prefixQuery = {
        isActive: true,
        name: { $regex: `^${escapedQuery}`, $options: 'i' },
      };
      if (categories.length > 0) {
        prefixQuery.category = { $in: categories };
      }

      const prefixCandidates = await Product.find(prefixQuery)
        .select({ _id: 0, name: 1, category: 1 })
        .sort({ name: 1 })
        .collation({ locale: 'en', strength: 2 })
        .limit(limit * 2)
        .lean();

      let candidates = prefixCandidates;
      if (candidates.length < limit) {
        const containsQuery = {
          isActive: true,
          name: { $regex: escapedQuery, $options: 'i' },
        };
        if (categories.length > 0) {
          containsQuery.category = { $in: categories };
        }

        const containsCandidates = await Product.find(containsQuery)
          .select({ _id: 0, name: 1, category: 1 })
          .sort({ name: 1 })
          .collation({ locale: 'en', strength: 2 })
          .limit(limit * 3)
          .lean();

        candidates = [...prefixCandidates, ...containsCandidates];
      }

      const deduped = new Map();
      for (const item of candidates) {
        if (!item || typeof item.name !== 'string') {
          continue;
        }

        const normalizedName = item.name.trim();
        if (!normalizedName) {
          continue;
        }

        const dedupeKey = normalizedName.toLowerCase();
        if (!deduped.has(dedupeKey)) {
          deduped.set(dedupeKey, {
            text: normalizedName,
            category: typeof item.category === 'string' ? item.category : null,
            score: null,
            source: 'mongo',
          });
        }
        if (deduped.size >= limit) {
          break;
        }
      }

      const lexicalSuggestions = [...deduped.values()].slice(0, limit);
      if (lexicalSuggestions.length > 0) {
        return lexicalSuggestions;
      }

      if (
        !SEARCH_SUGGESTION_ENABLE_SEMANTIC_FALLBACK
        || !productSemanticSearchService
        || typeof productSemanticSearchService.isEnabled !== 'function'
        || typeof productSemanticSearchService.searchProducts !== 'function'
        || !productSemanticSearchService.isEnabled()
      ) {
        return lexicalSuggestions;
      }

      try {
        const semanticMatches = await productSemanticSearchService.searchProducts({
          search: query,
          category: categories.length === 1 ? categories[0] : undefined,
          categories: categories.length > 0 ? categories : undefined,
          limit: Math.min(limit * 3, 30),
          offset: 0,
        });

        const semanticDeduped = new Map();
        for (const item of semanticMatches) {
          if (!item || typeof item.name !== 'string') {
            continue;
          }

          const normalizedName = item.name.trim();
          if (!normalizedName) {
            continue;
          }

          const dedupeKey = normalizedName.toLowerCase();
          if (!semanticDeduped.has(dedupeKey)) {
            semanticDeduped.set(dedupeKey, {
              text: normalizedName,
              category: typeof item.category === 'string' ? item.category : null,
              score: Number.isFinite(item.semanticScore) ? item.semanticScore : null,
              source: 'semantic',
            });
          }
          if (semanticDeduped.size >= limit) {
            break;
          }
        }

        return [...semanticDeduped.values()].slice(0, limit);
      } catch (error) {
        console.warn('Semantic suggestion fallback failed:', error.message);
      }

      return lexicalSuggestions;
    }
  );
}

/**
 * Fetches semantic search status.
 * @param {{productSemanticSearchService: object}} deps Dependencies.
 * @return {Promise<object>} Status payload.
 */
function getSemanticSearchStatus({ productSemanticSearchService }) {
  return productSemanticSearchService.getStatus();
}

/**
 * Reindexes semantic product vectors.
 * @param {{productSemanticSearchService: object}} deps Dependencies.
 * @return {Promise<object>} Reindex summary.
 */
function reindexSemanticSearch({ productSemanticSearchService }) {
  return productSemanticSearchService.reindexAllActiveProducts();
}

module.exports = {
  getCategories,
  getProductById,
  getProducts,
  getProductsBySeller,
  getSearchSuggestions,
  getSemanticSearchStatus,
  reindexSemanticSearch,
};
