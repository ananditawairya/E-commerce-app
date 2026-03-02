const {
  CATALOG_NAMESPACE,
  DEFAULT_SUGGESTION_CACHE_TTL_MS,
  DEFAULT_SUGGESTION_LIMIT,
  MAX_SUGGESTION_LIMIT,
  SEARCH_SUGGESTION_ENABLE_SEMANTIC_FALLBACK,
} = require('./constants');
const { getNamespaceVersion, withOptionalCache } = require('./cacheUtils');
const { escapeRegExp, normalizeStringArray, stableStringify } = require('./queryUtils');

/**
 * Fetches search suggestions with dedicated engine fallback.
 * @param {{
 *   Product: object,
 *   cacheService?: object,
 *   searchEngineService?: object,
 *   productSemanticSearchService?: object,
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

module.exports = {
  getSearchSuggestions,
};
