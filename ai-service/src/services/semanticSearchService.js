// ai-service/src/services/semanticSearchService.js
// Semantic product retrieval with cached embeddings and fail-open behavior.

const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const cacheService = require('./cacheService');

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';
const PRODUCT_FETCH_TIMEOUT_MS = Number.parseInt(process.env.AI_PRODUCT_FETCH_TIMEOUT_MS || '6000', 10);

const SEMANTIC_ENABLED = String(process.env.AI_SEMANTIC_ENABLED || 'true').toLowerCase() !== 'false';
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-004';
const SEMANTIC_MAX_PRODUCTS = Number.parseInt(process.env.AI_SEMANTIC_MAX_PRODUCTS || '120', 10);
const SEMANTIC_PAGE_SIZE = Math.min(50, Number.parseInt(process.env.AI_SEMANTIC_PAGE_SIZE || '50', 10));
const SEMANTIC_MIN_SCORE = Number.parseFloat(process.env.AI_SEMANTIC_MIN_SCORE || '0.42');
const SEMANTIC_SEARCH_TIMEOUT_MS = Number.parseInt(process.env.AI_SEMANTIC_SEARCH_TIMEOUT_MS || '1400', 10);
const SEMANTIC_REINDEX_DELAY_MS = Number.parseInt(process.env.AI_SEMANTIC_REINDEX_DELAY_MS || '5000', 10);

const SEMANTIC_INDEX_STALE_MS = Number.parseInt(process.env.AI_SEMANTIC_INDEX_STALE_MS || '600000', 10);
const SEMANTIC_INDEX_CACHE_TTL_MS = Number.parseInt(process.env.AI_SEMANTIC_INDEX_CACHE_TTL_MS || '21600000', 10);
const SEMANTIC_QUERY_EMBED_TTL_MS = Number.parseInt(process.env.AI_SEMANTIC_QUERY_EMBED_TTL_MS || '1800000', 10);
const SEMANTIC_PRODUCT_EMBED_TTL_MS = Number.parseInt(process.env.AI_SEMANTIC_PRODUCT_EMBED_TTL_MS || '86400000', 10);

const INDEX_CACHE_KEY = 'ai:semantic:index:v1';

const sanitizeText = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/\s+/g, ' ');
};

const buildInternalHeaders = () => ({
    'Content-Type': 'application/json',
    'x-internal-gateway-token': jwt.sign(
        { service: 'ai-service' },
        INTERNAL_JWT_SECRET,
        { expiresIn: '2m' }
    ),
});

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
    let timer;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
};

const executeProductServiceQuery = async (query, variables = {}) => {
    const response = await axios.post(
        `${PRODUCT_SERVICE_URL}/graphql`,
        { query, variables },
        {
            headers: buildInternalHeaders(),
            timeout: PRODUCT_FETCH_TIMEOUT_MS,
        }
    );

    if (response.data?.errors?.length) {
        const firstError = response.data.errors[0];
        throw new Error(firstError?.message || 'Product service GraphQL query failed');
    }

    return response.data?.data || {};
};

const normalizeVector = (values) => {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }

    const cleaned = values.map((value) => (Number.isFinite(value) ? value : 0));
    const magnitude = Math.sqrt(cleaned.reduce((sum, value) => sum + (value * value), 0));

    if (!Number.isFinite(magnitude) || magnitude === 0) {
        return null;
    }

    return cleaned.map((value) => value / magnitude);
};

const cosineSimilarityNormalized = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
    }

    return dot;
};

const getTotalStock = (product) => {
    return (product.variants || []).reduce((sum, variant) => {
        return sum + (typeof variant.stock === 'number' ? variant.stock : 0);
    }, 0);
};

const buildProductDocumentText = (product) => {
    const variantNames = (product.variants || [])
        .slice(0, 5)
        .map((variant) => sanitizeText(variant.name))
        .filter(Boolean)
        .join(', ');

    return sanitizeText([
        product.name,
        product.category,
        product.description,
        variantNames ? `variants ${variantNames}` : '',
        `price ${product.basePrice}`,
    ].join('. ')).slice(0, 1200);
};

const createTextHash = (value) => {
    return crypto
        .createHash('sha256')
        .update(String(value || ''))
        .digest('hex')
        .slice(0, 24);
};

const extractTokens = (value) => {
    return sanitizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3)
        .slice(0, 12);
};

const lexicalOverlapBoost = (queryText, product) => {
    const queryTokens = extractTokens(queryText);
    if (queryTokens.length === 0) {
        return 0;
    }

    const haystack = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLowerCase();
    const hits = queryTokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
    return hits / queryTokens.length;
};

const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
};

class SemanticSearchService {
    constructor() {
        this.genAI = process.env.GEMINI_API_KEY
            ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            : null;
        this.embeddingModel = null;

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
            model: EMBEDDING_MODEL,
        };
    }

    getEmbeddingModel() {
        if (!this.isEnabled()) {
            return null;
        }

        if (!this.embeddingModel) {
            this.embeddingModel = this.genAI.getGenerativeModel({
                model: EMBEDDING_MODEL,
            });
        }

        return this.embeddingModel;
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

        if (cacheKey) {
            const cached = await cacheService.getJson(cacheKey);
            if (Array.isArray(cached) && cached.length > 0) {
                return {
                    vector: cached,
                    cacheHit: true,
                };
            }
        }

        const model = this.getEmbeddingModel();
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

        if (cacheKey) {
            await cacheService.setJson(cacheKey, vector, ttlMs);
        }

        return {
            vector,
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
                console.warn(`Semantic embedding failed for product ${product?.id}:`, error.message);
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
                const errorMessage = error?.message || 'unknown error';
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

    async search(query, options = {}) {
        const cleanQuery = sanitizeText(query);
        const limit = Number.parseInt(options.limit || '12', 10);

        if (!this.isEnabled() || !cleanQuery) {
            return {
                products: [],
                semanticUsed: false,
                cacheHit: false,
                reason: 'disabled_or_empty',
            };
        }

        try {
            const indexState = await this.ensureIndex({
                force: false,
                waitForBuild: false,
                reason: 'search',
            });

            if (!indexState.ready || this.index.products.length === 0) {
                return {
                    products: [],
                    semanticUsed: false,
                    cacheHit: false,
                    reason: 'index_warming',
                };
            }

            const queryEmbedKey = `ai:semantic:q:${createTextHash(cleanQuery.toLowerCase())}`;
            const queryEmbedding = await withTimeout(
                this.embedText(cleanQuery, queryEmbedKey, SEMANTIC_QUERY_EMBED_TTL_MS),
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

            this.index.products.forEach((product) => {
                if (!this.applyFilters(product, options)) {
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
                .sort((a, b) => b.score - a.score)
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
            this.lastError = {
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

    async searchProducts(query, options = {}) {
        const semantic = await this.search(query, {
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
}

module.exports = new SemanticSearchService();
