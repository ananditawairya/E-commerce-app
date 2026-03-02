const {
  GET_CATEGORIES_QUERY,
  PRODUCT_BY_ID_QUERY,
  RETRIEVE_PRODUCTS_LEGACY_QUERY,
  RETRIEVE_PRODUCTS_QUERY,
} = require('./productGateway/queries');
const { applyLegacyFiltersAndSorting } = require('./productGateway/legacyFallback');

/**
 * Creates product-service gateway helpers for chatbot retrieval.
 * @param {{
 *   axios: object,
 *   jwt: object,
 *   cacheService: object,
 *   config: {
 *     categoryCacheTtlMs: number,
 *     internalJwtSecret: string,
 *     legacyCompatibilityErrorPattern: RegExp,
 *     productFetchTimeoutMs: number,
 *     productServiceUrl: string,
 *     retrievalCacheTtlMs: number,
 *   },
 *   textUtils: {
 *     cacheKeyPart: (value: unknown) => string,
 *     getTotalStock: (product: object) => number,
 *     sanitizeText: (value: unknown) => string,
 *   },
 * }} deps Gateway dependencies.
 * @return {{
 *   executeProductServiceQuery: (query: string, variables?: object) => Promise<object>,
 *   fetchProducts: (params: object) => Promise<object[]>,
 *   fetchProductById: (productId: string) => Promise<object|null>,
 *   fetchProductsByIds: (productIds: string[], maxCount?: number) => Promise<object[]>,
 *   fetchProductsWithCache: (params: object) => Promise<{products: object[], cacheHit: boolean}>,
 *   fetchCategories: () => Promise<string[]>,
 * }} Gateway functions.
 */
function createProductGateway(deps) {
  const {
    axios,
    jwt,
    cacheService,
    config,
    textUtils,
  } = deps;

  const {
    categoryCacheTtlMs,
    internalJwtSecret,
    legacyCompatibilityErrorPattern,
    productFetchTimeoutMs,
    productServiceUrl,
    retrievalCacheTtlMs,
  } = config;

  const {
    cacheKeyPart,
    getTotalStock,
    sanitizeText,
  } = textUtils;

  const categoryCache = {
    categories: [],
    fetchedAt: 0,
  };

  /**
   * Builds internal authorization headers for product-service calls.
   * @return {object} HTTP headers.
   */
  function buildInternalHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-internal-gateway-token': jwt.sign(
        { service: 'ai-service' },
        internalJwtSecret,
        { expiresIn: '2m' }
      ),
    };
  }

  /**
   * Executes GraphQL query against product-service.
   * @param {string} query GraphQL query.
   * @param {object=} variables Query variables.
   * @return {Promise<object>} GraphQL data payload.
   */
  async function executeProductServiceQuery(query, variables = {}) {
    const response = await axios.post(
      `${productServiceUrl}/graphql`,
      { query, variables },
      {
        headers: buildInternalHeaders(),
        timeout: productFetchTimeoutMs,
      }
    );

    if (response.data?.errors?.length) {
      const firstError = response.data.errors[0];
      throw new Error(firstError?.message || 'Product service GraphQL query failed');
    }

    return response.data?.data || {};
  }

  /**
   * Fetches products with optional filters.
   * @param {{
 *   search?: string|null,
 *   category?: string|null,
 *   minPrice?: number|null,
 *   maxPrice?: number|null,
 *   inStockOnly?: boolean,
 *   sortBy?: string,
 *   limit?: number,
 *   offset?: number,
 * }} params Product query params.
   * @return {Promise<object[]>} Product list.
   */
  async function fetchProducts({
    search = null,
    category = null,
    minPrice = null,
    maxPrice = null,
    inStockOnly = true,
    sortBy = 'RELEVANCE',
    limit = 16,
    offset = 0,
  }) {
    const safeSearch = sanitizeText(search) || null;

    try {
      const data = await executeProductServiceQuery(RETRIEVE_PRODUCTS_QUERY, {
        search: safeSearch,
        category: category || null,
        minPrice,
        maxPrice,
        inStockOnly,
        sortBy,
        limit,
        offset,
      });

      return data.products || [];
    } catch (error) {
      if (!legacyCompatibilityErrorPattern.test(error.message || '')) {
        throw error;
      }

      const legacyData = await executeProductServiceQuery(RETRIEVE_PRODUCTS_LEGACY_QUERY, {
        search: safeSearch,
        category: category || null,
        limit: Math.max(limit * 3, 24),
        offset,
      });

      return applyLegacyFiltersAndSorting({
        products: legacyData.products || [],
        minPrice,
        maxPrice,
        inStockOnly,
        sortBy,
        limit,
        getTotalStock,
      });
    }
  }

  /**
   * Fetches one product by id.
   * @param {string} productId Product id.
   * @return {Promise<object|null>} Product or null.
   */
  async function fetchProductById(productId) {
    if (!productId) {
      return null;
    }

    try {
      const data = await executeProductServiceQuery(PRODUCT_BY_ID_QUERY, { id: productId });
      return data.product || null;
    } catch (error) {
      console.warn(`fetchProductById failed for ${productId}:`, error.message);
      return null;
    }
  }

  /**
   * Fetches multiple products by id list.
   * @param {string[]} productIds Product ids.
   * @param {number=} maxCount Maximum id count.
   * @return {Promise<object[]>} Product list.
   */
  async function fetchProductsByIds(productIds, maxCount = 10) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(productIds.filter(Boolean))].slice(0, maxCount);
    const settled = await Promise.allSettled(uniqueIds.map((id) => fetchProductById(id)));

    return settled
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
  }

  /**
   * Builds retrieval cache key from product query params.
   * @param {object} params Product query params.
   * @return {string} Cache key.
   */
  function buildRetrievalCacheKey(params) {
    return [
      'ai',
      'retrieval',
      cacheKeyPart(params.search),
      cacheKeyPart(params.category),
      cacheKeyPart(params.minPrice),
      cacheKeyPart(params.maxPrice),
      cacheKeyPart(params.inStockOnly),
      cacheKeyPart(params.sortBy),
      cacheKeyPart(params.limit),
      cacheKeyPart(params.offset),
    ].join(':');
  }

  /**
   * Fetches products via cache-aside retrieval key.
   * @param {object} params Product query params.
   * @return {Promise<{products: object[], cacheHit: boolean}>} Cached retrieval result.
   */
  async function fetchProductsWithCache(params) {
    const key = buildRetrievalCacheKey(params);
    const { value, cacheHit } = await cacheService.withJsonCache(
      key,
      retrievalCacheTtlMs,
      () => fetchProducts(params)
    );

    return {
      products: Array.isArray(value) ? value : [],
      cacheHit,
    };
  }

  /**
   * Fetches and caches product categories.
   * @return {Promise<string[]>} Category list.
   */
  async function fetchCategories() {
    const now = Date.now();
    if (
      categoryCache.categories.length > 0
      && now - categoryCache.fetchedAt < categoryCacheTtlMs
    ) {
      return categoryCache.categories;
    }

    const cacheKey = 'ai:chat:categories:v1';
    const cachedCategories = await cacheService.getJson(cacheKey);
    if (Array.isArray(cachedCategories) && cachedCategories.length > 0) {
      categoryCache.categories = cachedCategories;
      categoryCache.fetchedAt = now;
      return cachedCategories;
    }

    try {
      const data = await executeProductServiceQuery(GET_CATEGORIES_QUERY);
      const categories = Array.isArray(data.categories) ? data.categories : [];
      categoryCache.categories = categories;
      categoryCache.fetchedAt = now;
      await cacheService.setJson(cacheKey, categories, categoryCacheTtlMs);
      return categories;
    } catch (error) {
      console.error('Failed to fetch categories for chat retrieval:', error.message);
      return categoryCache.categories;
    }
  }

  return {
    executeProductServiceQuery,
    fetchCategories,
    fetchProductById,
    fetchProducts,
    fetchProductsByIds,
    fetchProductsWithCache,
  };
}

module.exports = {
  createProductGateway,
};
