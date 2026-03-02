const { GoogleGenerativeAI } = require('@google/generative-ai');
const cacheService = require('./cacheService');
const {
    EMBEDDING_API_VERSION,
    EMBEDDING_MODEL,
    EMBEDDING_MODEL_CANDIDATES,
    INDEX_CACHE_KEY,
    SEMANTIC_ENABLED,
    SEMANTIC_INDEX_CACHE_TTL_MS,
    SEMANTIC_INDEX_STALE_MS,
    SEMANTIC_MAX_PRODUCTS,
    SEMANTIC_PAGE_SIZE,
    SEMANTIC_PRODUCT_EMBED_TTL_MS,
    SEMANTIC_REINDEX_DELAY_MS,
    SEMANTIC_SEARCH_TIMEOUT_MS,
} = require('./semanticSearch/config');
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
    withTimeout,
} = require('./semanticSearch/helpers');
const searchOperations = require('./semanticSearch/searchOperations');

class SemanticSearchService {
    constructor() {
        this.genAI = process.env.GEMINI_API_KEY
            ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            : null;
        this.embeddingModel = null;
        this.embeddingModelName = null;
        this.failedEmbeddingModels = new Set();
        this.embeddingModelsExhausted = false;

        this.index = {
            products: [],
            updatedAt: 0,
            source: 'cold_start',
            stats: {
                indexed: 0,
                skipped: 0,
                failed: 0,
            },
        };

        this.indexBuildPromise = null;
        this.reindexTimer = null;
        this.lastError = null;
    }

    isEnabled() {
        return Boolean(SEMANTIC_ENABLED && this.genAI);
    }

    getPublicStatus() {
        return {
            enabled: this.isEnabled(),
            indexSize: this.index.products.length,
            updatedAt: this.index.updatedAt ? new Date(this.index.updatedAt).toISOString() : null,
            building: Boolean(this.indexBuildPromise),
            source: this.index.source,
            stats: this.index.stats,
            lastError: this.lastError,
            model: this.embeddingModelName || EMBEDDING_MODEL || null,
            modelCandidates: EMBEDDING_MODEL_CANDIDATES,
            apiVersion: EMBEDDING_API_VERSION,
        };
    }

    getEmbeddingModel() {
        if (!this.isEnabled() || this.embeddingModelsExhausted) {
            return null;
        }

        if (!this.embeddingModel || !this.embeddingModelName) {
            const nextModelName = EMBEDDING_MODEL_CANDIDATES.find(
                (modelName) => !this.failedEmbeddingModels.has(modelName)
            );

            if (!nextModelName) {
                this.embeddingModelsExhausted = true;
                return null;
            }

            this.embeddingModelName = nextModelName;
            this.embeddingModel = this.genAI.getGenerativeModel({
                model: nextModelName,
            }, {
                apiVersion: EMBEDDING_API_VERSION,
            });
        }

        return this.embeddingModel;
    }

    markEmbeddingModelUnavailable(modelName, error) {
        if (modelName) {
            this.failedEmbeddingModels.add(modelName);
        }

        this.embeddingModel = null;
        this.embeddingModelName = null;

        if (this.failedEmbeddingModels.size >= EMBEDDING_MODEL_CANDIDATES.length) {
            this.embeddingModelsExhausted = true;
            this.lastError = {
                message: 'No supported embedding model configured',
                at: new Date().toISOString(),
                reason: 'embedding_model_unavailable',
                triedModels: EMBEDDING_MODEL_CANDIDATES,
            };
            return;
        }

        console.warn(
            `Embedding model "${modelName}" unavailable (${error?.message || 'unknown error'}). Trying fallback model...`
        );
    }

    async loadIndexFromCache() {
        const cachedIndex = await cacheService.getJson(INDEX_CACHE_KEY);
        if (!cachedIndex || !Array.isArray(cachedIndex.products) || cachedIndex.products.length === 0) {
            return false;
        }

        this.index = {
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

    isIndexFresh() {
        if (!this.index.updatedAt || this.index.products.length === 0) {
            return false;
        }

        return Date.now() - this.index.updatedAt < SEMANTIC_INDEX_STALE_MS;
    }

    async fetchCatalogForIndex(maxProducts = SEMANTIC_MAX_PRODUCTS) {
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

    async embedText(text, cacheKey, ttlMs) {
        const normalizedText = sanitizeText(text).slice(0, 1200);
        if (!normalizedText || !this.isEnabled()) {
            return {
                vector: null,
                cacheHit: false,
            };
        }

        const maxModelAttempts = Math.max(1, EMBEDDING_MODEL_CANDIDATES.length);

        for (let attempt = 0; attempt < maxModelAttempts; attempt += 1) {
            const model = this.getEmbeddingModel();
            const activeModelName = this.embeddingModelName;
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
                    this.markEmbeddingModelUnavailable(activeModelName, error);
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

    async rebuildIndex(reason = 'manual') {
        if (!this.isEnabled()) {
            return this.getPublicStatus();
        }

        const products = await this.fetchCatalogForIndex();
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
                // eslint-disable-next-line no-continue
                continue;
            }

            try {
                const versionTag = sanitizeText(product.updatedAt || product.createdAt || 'na');
                const productEmbedKey = `ai:semantic:prod:${product.id}:${createTextHash(versionTag)}`;
                const { vector } = await this.embedText(
                    content,
                    productEmbedKey,
                    SEMANTIC_PRODUCT_EMBED_TTL_MS
                );

                if (!vector) {
                    skipped += 1;
                    // eslint-disable-next-line no-continue
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

        this.index = {
            products: indexedProducts,
            updatedAt: Date.now(),
            source: reason,
            stats: {
                indexed: indexedProducts.length,
                skipped,
                failed,
            },
        };

        await cacheService.setJson(INDEX_CACHE_KEY, this.index, SEMANTIC_INDEX_CACHE_TTL_MS);
        this.lastError = null;

        return this.getPublicStatus();
    }

    startRebuild(reason = 'manual') {
        if (this.indexBuildPromise) {
            return this.indexBuildPromise;
        }

        this.indexBuildPromise = this.rebuildIndex(reason)
            .catch((error) => {
                const errorMessage = extractErrorMessage(error);
                this.lastError = {
                    message: errorMessage,
                    at: new Date().toISOString(),
                    reason,
                };
                console.warn('Semantic index rebuild failed:', errorMessage);
                return this.getPublicStatus();
            })
            .finally(() => {
                this.indexBuildPromise = null;
            });

        return this.indexBuildPromise;
    }

    scheduleReindex(reason = 'scheduled') {
        if (!this.isEnabled()) {
            return;
        }

        if (this.reindexTimer) {
            return;
        }

        this.reindexTimer = setTimeout(() => {
            this.reindexTimer = null;
            this.startRebuild(reason);
        }, SEMANTIC_REINDEX_DELAY_MS);

        this.reindexTimer.unref();
    }

    async ensureIndex({ force = false, waitForBuild = false, reason = 'ensure' } = {}) {
        if (!this.isEnabled()) {
            return {
                ready: false,
                cacheHit: false,
                building: false,
            };
        }

        if (force) {
            await this.startRebuild(reason);
            return {
                ready: this.index.products.length > 0,
                cacheHit: false,
                building: Boolean(this.indexBuildPromise),
            };
        }

        if (this.isIndexFresh()) {
            return {
                ready: true,
                cacheHit: true,
                building: Boolean(this.indexBuildPromise),
            };
        }

        const loadedFromCache = await this.loadIndexFromCache();
        if (loadedFromCache && this.isIndexFresh()) {
            return {
                ready: true,
                cacheHit: true,
                building: Boolean(this.indexBuildPromise),
            };
        }

        this.startRebuild(reason);

        if (waitForBuild && this.indexBuildPromise) {
            await withTimeout(
                this.indexBuildPromise,
                SEMANTIC_SEARCH_TIMEOUT_MS,
                'Semantic index build timeout'
            );
        }

        return {
            ready: this.index.products.length > 0,
            cacheHit: loadedFromCache,
            building: Boolean(this.indexBuildPromise),
        };
    }

    async forceReindex(reason = 'manual_api') {
        const status = await this.ensureIndex({
            force: true,
            waitForBuild: true,
            reason,
        });

        return {
            ...this.getPublicStatus(),
            ready: status.ready,
        };
    }

    async invalidateIndex(reason = 'manual_invalidate') {
        this.index = {
            products: [],
            updatedAt: 0,
            source: reason,
            stats: {
                indexed: 0,
                skipped: 0,
                failed: 0,
            },
        };
        await cacheService.delete(INDEX_CACHE_KEY);
        this.scheduleReindex(reason);
        return this.getPublicStatus();
    }

    applyFilters(product, filters) {
        return searchOperations.applyFilters(product, filters);
    }

    async search(query, options = {}) {
        return searchOperations.search(this, query, options);
    }

    async searchProducts(query, options = {}) {
        return searchOperations.searchProducts(this, query, options);
    }

    /**
     * Finds similar products for a source product using vector similarity.
     * @param {string} productId Source product identifier.
     * @param {{
     *   limit?: number,
     *   minScore?: number,
     *   category?: string,
     *   minPrice?: number,
     *   maxPrice?: number,
     *   inStockOnly?: boolean,
     * }} options Optional filters and ranking controls.
     * @return {Promise<{
     *   results: Array<{
     *     productId: string,
     *     score: number,
     *     category: string|null,
     *     basePrice: number,
     *   }>,
     *   sourceCategory: string|null,
     *   cacheHit: boolean,
     *   semanticUsed: boolean,
     *   reason: string,
     *   error?: string,
     * }>} Similarity result payload.
     */
    async getSimilarProductsByProductId(productId, options = {}) {
        return searchOperations.getSimilarProductsByProductId(this, productId, options);
    }
}

module.exports = new SemanticSearchService();
