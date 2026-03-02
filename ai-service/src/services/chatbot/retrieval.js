/**
 * Creates candidate retrieval helpers for chatbot product search.
 * @param {{
 *   fetchProductsByIds: (productIds: string[], maxCount?: number) => Promise<object[]>,
 *   fetchProductsWithCache: (params: object) => Promise<{products: object[], cacheHit: boolean}>,
 *   extractKeywordQuery: (message: string, maxTokens?: number) => string,
 *   mergeUniqueProducts: (productLists: Array<object[]>) => object[],
 *   rerankProducts: (userMessage: string, products: object[], slots: object, semanticScoreMap?: Map<string, number>) => Promise<object[]>,
 *   sanitizeText: (value: unknown) => string,
 *   semanticSearchService: object,
 *   maxCandidateProducts: number,
 * }} deps Retrieval dependencies.
 * @return {{
 *   retrieveCandidateProducts: (message: string, conversation: object, slots: object) => Promise<{products: object[], cacheHit: boolean, semanticUsed: boolean}>,
 * }} Retrieval helpers.
 */
function createRetrievalTools(deps) {
  const {
    fetchProductsByIds,
    fetchProductsWithCache,
    extractKeywordQuery,
    mergeUniqueProducts,
    rerankProducts,
    sanitizeText,
    semanticSearchService,
    maxCandidateProducts,
  } = deps;

  /**
   * Retrieves and ranks candidate products for the active conversation turn.
   * @param {string} message User message.
   * @param {object} conversation Conversation state.
   * @param {object} slots Preference slots.
   * @return {Promise<{products: object[], cacheHit: boolean, semanticUsed: boolean}>}
   *     Candidate retrieval payload.
   */
  async function retrieveCandidateProducts(message, conversation, slots) {
    const searchSeed = [
      extractKeywordQuery(message, 10),
      sanitizeText(message),
      ...(slots.styleKeywords || []).slice(0, 2),
    ].filter((value, index, array) => value && array.indexOf(value) === index);

    const previousUserMessages = (conversation.messages || [])
      .filter((entry) => entry.role === 'user')
      .slice(-2)
      .map((entry) => sanitizeText(entry.parts?.[0]?.text || ''))
      .filter(Boolean);

    const contextualSearch = extractKeywordQuery([...previousUserMessages, message].join(' '), 10);
    if (contextualSearch) {
      searchSeed.unshift(contextualSearch);
    }

    const semanticSignalMap = new Map();
    let semanticProducts = [];
    let semanticCacheHit = true;

    try {
      const semanticQuery = sanitizeText(
        [...previousUserMessages.slice(-1), message].join(' ')
      );

      const semanticResult = await semanticSearchService.searchProducts(semanticQuery, {
        category: slots.category,
        minPrice: slots.minPrice,
        maxPrice: slots.maxPrice,
        inStockOnly: slots.inStockOnly,
        limit: 12,
      });

      semanticCacheHit = semanticResult.reason !== 'error'
        && (semanticResult.cacheHit === true || semanticResult.semanticUsed === false);

      if (Array.isArray(semanticResult.results) && semanticResult.results.length > 0) {
        semanticResult.results.forEach((entry) => {
          if (entry?.productId) {
            semanticSignalMap.set(entry.productId, Number(entry.score) || 0);
          }
        });

        const semanticIds = semanticResult.results.map((entry) => entry.productId);
        semanticProducts = await fetchProductsByIds(semanticIds, 12);
      }
    } catch (error) {
      semanticCacheHit = false;
      console.warn('Semantic retrieval failed, continuing with lexical retrieval:', error.message);
    }

    const baseQuery = {
      category: slots.category,
      minPrice: slots.minPrice,
      maxPrice: slots.maxPrice,
      inStockOnly: slots.inStockOnly,
      sortBy: slots.sortBy || 'RELEVANCE',
      limit: 16,
      offset: 0,
    };

    const searchQueries = searchSeed.slice(0, 3);

    const primaryRequests = searchQueries.length
      ? searchQueries.map((searchText) => fetchProductsWithCache({
        ...baseQuery,
        search: searchText,
      }))
      : [fetchProductsWithCache({ ...baseQuery, search: null })];

    const settledPrimary = await Promise.allSettled(primaryRequests);
    const primaryProducts = settledPrimary
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value.products || []);

    const fulfilledPrimary = settledPrimary.filter((result) => result.status === 'fulfilled');
    let cacheHit = semanticCacheHit
      && fulfilledPrimary.length > 0
      && fulfilledPrimary.every((result) => result.value.cacheHit === true);

    let mergedProducts = mergeUniqueProducts([semanticProducts, primaryProducts]);

    if (mergedProducts.length < 8) {
      try {
        const fallback = await fetchProductsWithCache({
          ...baseQuery,
          search: null,
          sortBy: 'NEWEST',
        });
        cacheHit = cacheHit && fallback.cacheHit;
        mergedProducts = mergeUniqueProducts([mergedProducts, fallback.products]);
      } catch (error) {
        console.warn('Fallback retrieval failed:', error.message);
        cacheHit = false;
      }
    }

    if (mergedProducts.length === 0) {
      try {
        const globalFallback = await fetchProductsWithCache({
          category: null,
          minPrice: slots.minPrice,
          maxPrice: slots.maxPrice,
          inStockOnly: slots.inStockOnly,
          sortBy: 'NEWEST',
          search: null,
          limit: 16,
          offset: 0,
        });
        cacheHit = cacheHit && globalFallback.cacheHit;
        mergedProducts = mergeUniqueProducts([globalFallback.products]);
      } catch (error) {
        console.warn('Global fallback retrieval failed:', error.message);
        cacheHit = false;
      }
    }

    const reranked = await rerankProducts(message, mergedProducts, slots, semanticSignalMap);
    const semanticUsed = semanticSignalMap.size > 0;

    return {
      products: reranked.slice(0, maxCandidateProducts),
      cacheHit,
      semanticUsed,
    };
  }

  return {
    retrieveCandidateProducts,
  };
}

module.exports = {
  createRetrievalTools,
};
