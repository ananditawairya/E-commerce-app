const {
  CATALOG_NAMESPACE,
  DEFAULT_CATALOG_CACHE_TTL_MS,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  RELEVANCE_CANDIDATE_MULTIPLIER,
  RELEVANCE_LEXICAL_WEAK_THRESHOLD,
  RELEVANCE_MAX_CANDIDATES,
  RELEVANCE_MIN_CANDIDATES,
} = require('./constants');
const {
  applyPriceFilter,
  clamp,
  normalizeStringArray,
  resolveSortOptions,
  stableStringify,
} = require('./queryUtils');
const { getNamespaceVersion, withOptionalCache } = require('./cacheUtils');
const { mergeCandidates, rerankCandidates } = require('./relevance');

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

module.exports = {
  getCategories,
  getProductById,
  getProducts,
  getProductsBySeller,
};
