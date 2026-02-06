// ai-service/src/services/chatbotService.js
// AI Shopping Assistant with structured output, slot memory, reranking, safety checks, and cache-backed retrieval.

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const ProductScore = require('../models/ProductScore');
const cacheService = require('./cacheService');
const semanticSearchService = require('./semanticSearchService');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const conversations = new Map();

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

const CATEGORY_CACHE_TTL_MS = Number.parseInt(process.env.CATEGORY_CACHE_TTL_MS || '300000', 10);
const PRODUCT_FETCH_TIMEOUT_MS = Number.parseInt(process.env.AI_PRODUCT_FETCH_TIMEOUT_MS || '6000', 10);
const RETRIEVAL_CACHE_TTL_MS = Number.parseInt(process.env.AI_RETRIEVAL_CACHE_TTL_MS || '90000', 10);
const CONVERSATION_CACHE_TTL_MS = Number.parseInt(process.env.AI_CONVERSATION_CACHE_TTL_MS || '3600000', 10);
const MODEL_TIMEOUT_MS = Number.parseInt(process.env.AI_MODEL_TIMEOUT_MS || '4200', 10);

const MAX_CANDIDATE_PRODUCTS = Number.parseInt(process.env.AI_CHAT_MAX_CANDIDATES || '16', 10);
const MAX_PRODUCTS_IN_PROMPT = Number.parseInt(process.env.AI_CHAT_PROMPT_PRODUCTS || '10', 10);
const MAX_HISTORY_TURNS = Number.parseInt(process.env.AI_CHAT_HISTORY_TURNS || '4', 10);
const MAX_CONVERSATION_MEMORY = Number.parseInt(process.env.AI_CHAT_CONVERSATION_MEMORY || '300', 10);
const MIN_GAP_BETWEEN_MESSAGES_MS = Number.parseInt(process.env.AI_CHAT_MIN_MESSAGE_GAP_MS || '400', 10);

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'buy', 'can', 'do', 'for',
    'from', 'get', 'give', 'have', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of',
    'on', 'or', 'please', 'show', 'that', 'the', 'their', 'them', 'this', 'to', 'want',
    'with', 'you', 'your', 'something', 'need', 'any', 'some', 'tell', 'what', 'which',
]);

const BLOCKED_PATTERNS = [
    /\b(kill|murder|suicide|self-harm)\b/i,
    /\b(bomb|explosive|weapon)\b/i,
    /\b(hate\s+speech|racist\s+slur)\b/i,
];

const PROMPT_ATTACK_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /reveal\s+(your\s+)?(system|developer)\s+prompt/i,
    /show\s+(hidden|internal)\s+instructions/i,
    /act\s+as\s+system/i,
];

const LEGACY_COMPATIBILITY_ERROR_PATTERN = /Unknown argument|Unknown type|Cannot query field|is not defined by type/i;

const categoryCache = {
    categories: [],
    fetchedAt: 0,
};

const sanitizeText = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/\s+/g, ' ');
};

const normalizeMultiLineText = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    return value
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const stripTechnicalIdentifiers = (value) => {
    return normalizeMultiLineText(
        String(value || '')
            .replace(/\(ID:\s*[A-Za-z0-9-]+\)/gi, '')
            .replace(/\bID:\s*[A-Za-z0-9-]+\b/gi, '')
            .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '')
    );
};

const parseNumericValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).replace(/[$,]/g, '').trim();
    const numericValue = Number.parseFloat(normalized);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const formatMoney = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '$0.00';
    }
    return `$${value.toFixed(2)}`;
};

const getTotalStock = (product) => {
    return (product.variants || []).reduce((sum, variant) => {
        return sum + (typeof variant.stock === 'number' ? variant.stock : 0);
    }, 0);
};

const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
};

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

const buildInternalHeaders = () => ({
    'Content-Type': 'application/json',
    'x-internal-gateway-token': jwt.sign(
        { service: 'ai-service' },
        INTERNAL_JWT_SECRET,
        { expiresIn: '2m' }
    ),
});

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

const fetchProducts = async ({
    search = null,
    category = null,
    minPrice = null,
    maxPrice = null,
    inStockOnly = true,
    sortBy = 'RELEVANCE',
    limit = 16,
    offset = 0,
}) => {
    const query = `
      query RetrieveProducts(
        $search: String
        $category: String
        $minPrice: Float
        $maxPrice: Float
        $inStockOnly: Boolean
        $sortBy: ProductSortBy
        $limit: Int
        $offset: Int
      ) {
        products(
          search: $search
          category: $category
          minPrice: $minPrice
          maxPrice: $maxPrice
          inStockOnly: $inStockOnly
          sortBy: $sortBy
          limit: $limit
          offset: $offset
        ) {
          id
          name
          description
          category
          basePrice
          images
          createdAt
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

    const safeSearch = sanitizeText(search) || null;
    try {
        const data = await executeProductServiceQuery(query, {
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
        if (!LEGACY_COMPATIBILITY_ERROR_PATTERN.test(error.message || '')) {
            throw error;
        }

        const legacyQuery = `
          query RetrieveProductsLegacy(
            $search: String
            $category: String
            $limit: Int
            $offset: Int
          ) {
            products(
              search: $search
              category: $category
              limit: $limit
              offset: $offset
            ) {
              id
              name
              description
              category
              basePrice
              images
              createdAt
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

        const legacyData = await executeProductServiceQuery(legacyQuery, {
            search: safeSearch,
            category: category || null,
            limit: Math.max(limit * 3, 24),
            offset,
        });

        let products = legacyData.products || [];

        if (typeof minPrice === 'number') {
            products = products.filter((product) => product.basePrice >= minPrice);
        }

        if (typeof maxPrice === 'number') {
            products = products.filter((product) => product.basePrice <= maxPrice);
        }

        if (inStockOnly) {
            products = products.filter((product) => getTotalStock(product) > 0);
        }

        switch (sortBy) {
            case 'PRICE_LOW_TO_HIGH':
                products.sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));
                break;
            case 'PRICE_HIGH_TO_LOW':
                products.sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0));
                break;
            case 'NAME_A_TO_Z':
                products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                break;
            case 'NAME_Z_TO_A':
                products.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
                break;
            case 'NEWEST':
                products.sort((a, b) => {
                    const aTime = new Date(a.createdAt || 0).getTime();
                    const bTime = new Date(b.createdAt || 0).getTime();
                    return bTime - aTime;
                });
                break;
            case 'RELEVANCE':
            default:
                break;
        }

        return products.slice(0, limit);
    }
};

const fetchProductById = async (productId) => {
    if (!productId) {
        return null;
    }

    const query = `
      query ProductById($id: ID!) {
        product(id: $id) {
          id
          name
          description
          category
          basePrice
          images
          createdAt
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

    try {
        const data = await executeProductServiceQuery(query, { id: productId });
        return data.product || null;
    } catch (error) {
        console.warn(`fetchProductById failed for ${productId}:`, error.message);
        return null;
    }
};

const fetchProductsByIds = async (productIds, maxCount = 10) => {
    if (!Array.isArray(productIds) || productIds.length === 0) {
        return [];
    }

    const uniqueIds = [...new Set(productIds.filter(Boolean))].slice(0, maxCount);
    const settled = await Promise.allSettled(uniqueIds.map((id) => fetchProductById(id)));

    return settled
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value);
};

const cacheKeyPart = (value) => {
    if (value === undefined || value === null) {
        return 'null';
    }
    return encodeURIComponent(String(value).toLowerCase().slice(0, 120));
};

const fetchProductsWithCache = async (params) => {
    const key = [
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

    const { value, cacheHit } = await cacheService.withJsonCache(
        key,
        RETRIEVAL_CACHE_TTL_MS,
        () => fetchProducts(params)
    );

    return {
        products: Array.isArray(value) ? value : [],
        cacheHit,
    };
};

const fetchCategories = async () => {
    const now = Date.now();
    if (
        categoryCache.categories.length > 0 &&
        now - categoryCache.fetchedAt < CATEGORY_CACHE_TTL_MS
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

    const query = `
      query GetCategories {
        categories
      }
    `;

    try {
        const data = await executeProductServiceQuery(query);
        const categories = Array.isArray(data.categories) ? data.categories : [];
        categoryCache.categories = categories;
        categoryCache.fetchedAt = now;
        await cacheService.setJson(cacheKey, categories, CATEGORY_CACHE_TTL_MS);
        return categories;
    } catch (error) {
        console.error('Failed to fetch categories for chat retrieval:', error.message);
        return categoryCache.categories;
    }
};

const parsePriceConstraints = (message) => {
    const text = sanitizeText(message).toLowerCase();
    let minPrice = null;
    let maxPrice = null;

    const betweenMatch = text.match(/(?:between|from)\s*\$?([\d,]+(?:\.\d+)?)\s*(?:and|to|-)\s*\$?([\d,]+(?:\.\d+)?)/);
    if (betweenMatch) {
        minPrice = parseNumericValue(betweenMatch[1]);
        maxPrice = parseNumericValue(betweenMatch[2]);
    }

    if (maxPrice === null) {
        const underMatch = text.match(/(?:under|below|less than|upto|up to|max(?:imum)?)\s*\$?([\d,]+(?:\.\d+)?)/);
        if (underMatch) {
            maxPrice = parseNumericValue(underMatch[1]);
        }
    }

    if (minPrice === null) {
        const overMatch = text.match(/(?:over|above|more than|at least|min(?:imum)?)\s*\$?([\d,]+(?:\.\d+)?)/);
        if (overMatch) {
            minPrice = parseNumericValue(overMatch[1]);
        }
    }

    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        [minPrice, maxPrice] = [maxPrice, minPrice];
    }

    return { minPrice, maxPrice };
};

const extractKeywordTokens = (message, maxTokens = 10) => {
    const cleaned = sanitizeText(message)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ');

    return cleaned
        .split(/\s+/)
        .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token))
        .slice(0, maxTokens);
};

const extractKeywordQuery = (message, maxTokens = 10) => {
    return extractKeywordTokens(message, maxTokens).join(' ');
};

const detectCategory = (message, categories) => {
    const text = sanitizeText(message).toLowerCase();
    if (!text || !Array.isArray(categories) || categories.length === 0) {
        return null;
    }

    const sorted = [...categories].sort((a, b) => String(b).length - String(a).length);
    const matched = sorted.find((category) => text.includes(String(category).toLowerCase()));
    return matched || null;
};

const detectSortPreference = (message) => {
    const text = sanitizeText(message).toLowerCase();

    if (!text) {
        return null;
    }

    if (/cheapest|low\s*to\s*high|lowest\s*price|budget/.test(text)) {
        return 'PRICE_LOW_TO_HIGH';
    }

    if (/premium|high\s*to\s*low|expensive|luxury/.test(text)) {
        return 'PRICE_HIGH_TO_LOW';
    }

    if (/new|latest|recent/.test(text)) {
        return 'NEWEST';
    }

    return null;
};

const detectInStockOnlyPreference = (message) => {
    const text = sanitizeText(message).toLowerCase();

    if (!text) {
        return null;
    }

    if (/in\s*stock|available\s*now|ready\s*to\s*ship/.test(text)) {
        return true;
    }

    if (/out\s*of\s*stock\s*ok|any\s*availability|include\s*sold\s*out/.test(text)) {
        return false;
    }

    return null;
};

const mergeUniqueProducts = (productLists) => {
    const byId = new Map();

    for (const list of productLists) {
        for (const product of list || []) {
            if (product?.id && !byId.has(product.id)) {
                byId.set(product.id, product);
            }
        }
    }

    return Array.from(byId.values());
};

const createDefaultPreferenceSlots = () => ({
    category: null,
    minPrice: null,
    maxPrice: null,
    inStockOnly: true,
    sortBy: 'RELEVANCE',
    styleKeywords: [],
});

const mergePreferenceSlots = (previousSlots, newSlots) => {
    const previous = previousSlots || createDefaultPreferenceSlots();

    const merged = {
        ...createDefaultPreferenceSlots(),
        ...previous,
        ...newSlots,
    };

    const styleKeywords = [
        ...(Array.isArray(previous.styleKeywords) ? previous.styleKeywords : []),
        ...(Array.isArray(newSlots.styleKeywords) ? newSlots.styleKeywords : []),
    ];

    merged.styleKeywords = Array.from(new Set(styleKeywords)).slice(0, 8);

    return merged;
};

const deriveStyleKeywords = (message, detectedCategory) => {
    return extractKeywordTokens(message, 8).filter((token) => token !== String(detectedCategory || '').toLowerCase());
};

const extractPreferenceSlots = (message, categories, existingSlots) => {
    const { minPrice, maxPrice } = parsePriceConstraints(message);
    const detectedCategory = detectCategory(message, categories);
    const sortBy = detectSortPreference(message);
    const inStockOnly = detectInStockOnlyPreference(message);

    return mergePreferenceSlots(existingSlots, {
        category: detectedCategory || existingSlots?.category || null,
        minPrice: minPrice !== null ? minPrice : existingSlots?.minPrice ?? null,
        maxPrice: maxPrice !== null ? maxPrice : existingSlots?.maxPrice ?? null,
        inStockOnly: typeof inStockOnly === 'boolean' ? inStockOnly : existingSlots?.inStockOnly ?? true,
        sortBy: sortBy || existingSlots?.sortBy || 'RELEVANCE',
        styleKeywords: deriveStyleKeywords(message, detectedCategory),
    });
};

const getAppliedFilters = (slots) => {
    const filters = [];

    if (slots?.category) {
        filters.push(`Category: ${slots.category}`);
    }

    if (typeof slots?.minPrice === 'number' && typeof slots?.maxPrice === 'number') {
        filters.push(`Budget: ${formatMoney(slots.minPrice)} - ${formatMoney(slots.maxPrice)}`);
    } else if (typeof slots?.maxPrice === 'number') {
        filters.push(`Budget: Under ${formatMoney(slots.maxPrice)}`);
    } else if (typeof slots?.minPrice === 'number') {
        filters.push(`Budget: Above ${formatMoney(slots.minPrice)}`);
    }

    if (slots?.inStockOnly) {
        filters.push('In stock only');
    }

    if (slots?.sortBy && slots.sortBy !== 'RELEVANCE') {
        const sortLabelMap = {
            PRICE_LOW_TO_HIGH: 'Sort: Price low to high',
            PRICE_HIGH_TO_LOW: 'Sort: Price high to low',
            NEWEST: 'Sort: Newest',
        };

        if (sortLabelMap[slots.sortBy]) {
            filters.push(sortLabelMap[slots.sortBy]);
        }
    }

    if (slots?.styleKeywords?.length) {
        filters.push(`Style: ${slots.styleKeywords.slice(0, 3).join(', ')}`);
    }

    return filters;
};

const buildConversationCacheKey = (conversationId) => `ai:chat:conversation:${conversationId}`;

const deserializeConversation = (rawConversation, conversationId, userId) => {
    const base = {
        id: conversationId,
        userId,
        messages: [],
        lastRetrievedProducts: [],
        preferenceSlots: createDefaultPreferenceSlots(),
        lastUserMessageAt: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    if (!rawConversation || typeof rawConversation !== 'object') {
        return base;
    }

    return {
        ...base,
        ...rawConversation,
        id: conversationId,
        userId,
        messages: Array.isArray(rawConversation.messages) ? rawConversation.messages : [],
        lastRetrievedProducts: Array.isArray(rawConversation.lastRetrievedProducts)
            ? rawConversation.lastRetrievedProducts
            : [],
        preferenceSlots: mergePreferenceSlots(
            createDefaultPreferenceSlots(),
            rawConversation.preferenceSlots || {}
        ),
        lastUserMessageAt: Number.parseInt(rawConversation.lastUserMessageAt || '0', 10) || 0,
        createdAt: rawConversation.createdAt ? new Date(rawConversation.createdAt) : new Date(),
        updatedAt: rawConversation.updatedAt ? new Date(rawConversation.updatedAt) : new Date(),
    };
};

const loadConversation = async (conversationId, userId) => {
    if (conversations.has(conversationId)) {
        return conversations.get(conversationId);
    }

    const cachedConversation = await cacheService.getJson(buildConversationCacheKey(conversationId));
    const conversation = deserializeConversation(cachedConversation, conversationId, userId);
    conversations.set(conversationId, conversation);

    return conversation;
};

const persistConversation = async (conversation) => {
    conversations.set(conversation.id, conversation);
    await cacheService.setJson(
        buildConversationCacheKey(conversation.id),
        {
            ...conversation,
            createdAt: conversation.createdAt?.toISOString?.() || new Date().toISOString(),
            updatedAt: conversation.updatedAt?.toISOString?.() || new Date().toISOString(),
        },
        CONVERSATION_CACHE_TTL_MS
    );
};

const cleanupConversations = () => {
    if (conversations.size <= MAX_CONVERSATION_MEMORY) {
        return;
    }

    const oldest = [...conversations.entries()]
        .sort((a, b) => {
            const aTime = new Date(a[1]?.updatedAt || a[1]?.createdAt || 0).getTime();
            const bTime = new Date(b[1]?.updatedAt || b[1]?.createdAt || 0).getTime();
            return aTime - bTime;
        })[0];

    if (oldest) {
        conversations.delete(oldest[0]);
    }
};

const getPopularitySignalMap = async (products) => {
    const ids = (products || []).map((product) => product.id).filter(Boolean);
    if (!ids.length) {
        return new Map();
    }

    try {
        const scores = await ProductScore.find({
            productId: { $in: ids },
        }).select('productId trendingScore viewCount purchaseCount').lean();

        const maxTrending = Math.max(1, ...scores.map((score) => score.trendingScore || 0));
        const signalMap = new Map();

        scores.forEach((score) => {
            signalMap.set(score.productId, {
                trendingNormalized: clamp((score.trendingScore || 0) / maxTrending, 0, 1),
                viewCount: score.viewCount || 0,
                purchaseCount: score.purchaseCount || 0,
            });
        });

        return signalMap;
    } catch (error) {
        console.warn('Failed to load popularity signals:', error.message);
        return new Map();
    }
};

const scoreProduct = (product, userMessage, slots, popularitySignal, semanticScore, retrievalIndex) => {
    const haystack = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLowerCase();
    const tokens = extractKeywordTokens(userMessage, 12);

    let lexicalScore = 0;
    tokens.forEach((token) => {
        if (haystack.includes(token)) {
            lexicalScore += 1.5;
        }
        if ((product.name || '').toLowerCase().includes(token)) {
            lexicalScore += 1.25;
        }
        if ((product.category || '').toLowerCase().includes(token)) {
            lexicalScore += 0.8;
        }
    });

    let categoryScore = 0;
    if (slots?.category && String(product.category || '').toLowerCase() === String(slots.category).toLowerCase()) {
        categoryScore = 3;
    }

    let priceScore = 0;
    if (typeof slots?.minPrice === 'number' && product.basePrice >= slots.minPrice) {
        priceScore += 1;
    }
    if (typeof slots?.maxPrice === 'number' && product.basePrice <= slots.maxPrice) {
        priceScore += 1;
    }
    if (typeof slots?.minPrice !== 'number' && typeof slots?.maxPrice !== 'number') {
        priceScore += 0.4;
    }

    const totalStock = getTotalStock(product);
    const stockScore = slots?.inStockOnly
        ? (totalStock > 0 ? 2 : -5)
        : clamp(totalStock / 30, 0, 1.5);

    const popularityScore = clamp((popularitySignal?.trendingNormalized || 0) * 2.5, 0, 2.5);
    const semanticBonus = clamp((semanticScore || 0) * 4, 0, 4);

    const recencyScore = clamp(
        (Date.now() - new Date(product.createdAt || 0).getTime()) / (1000 * 60 * 60 * 24 * 30),
        0,
        2
    );
    const freshnessBonus = 2 - recencyScore;

    const retrievalOrderBonus = clamp((MAX_CANDIDATE_PRODUCTS - retrievalIndex) * 0.03, 0, 0.6);

    return lexicalScore
        + categoryScore
        + priceScore
        + stockScore
        + popularityScore
        + semanticBonus
        + freshnessBonus
        + retrievalOrderBonus;
};

const rerankProducts = async (userMessage, products, slots, semanticScoreMap = new Map()) => {
    const popularitySignals = await getPopularitySignalMap(products);

    const scored = (products || []).map((product, index) => {
        const popularitySignal = popularitySignals.get(product.id);
        const semanticScore = semanticScoreMap.get(product.id) || 0;
        const score = scoreProduct(product, userMessage, slots, popularitySignal, semanticScore, index);
        return { product, score };
    });

    return scored
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.product);
};

const buildCandidateContext = (products) => {
    if (!products || products.length === 0) {
        return [];
    }

    return products.slice(0, MAX_PRODUCTS_IN_PROMPT).map((product) => {
        const totalStock = getTotalStock(product);
        return {
            productId: product.id,
            name: sanitizeText(product.name),
            category: sanitizeText(product.category),
            price: Number.parseFloat((product.basePrice || 0).toFixed(2)),
            stock: totalStock,
            description: sanitizeText(product.description).slice(0, 180),
        };
    });
};

const buildStructuredSystemPrompt = () => {
    return `You are an AI shopping assistant for an e-commerce app.

You must return STRICT JSON with this exact structure:
{
  "reply": "string",
  "recommendations": [
    {
      "productId": "string",
      "reason": "string"
    }
  ],
  "followUpQuestion": "string"
}

Rules:
1. Use ONLY candidate products provided in the input payload.
2. Never expose internal IDs in reply text.
3. Keep reply concise, practical, and under 120 words.
4. Return 0-4 recommendations.
5. If intent is unclear, ask one short follow-up question.
6. Never include markdown fences or additional keys.`;
};

const extractJsonPayload = (rawText) => {
    if (!rawText) {
        return null;
    }

    const normalized = String(rawText)
        .replace(/^```json\s*/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();

    try {
        return JSON.parse(normalized);
    } catch (error) {
        const objectMatch = normalized.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
            return null;
        }

        try {
            return JSON.parse(objectMatch[0]);
        } catch (parseError) {
            return null;
        }
    }
};

const parseModelResponse = (rawText, candidateProducts) => {
    const payload = extractJsonPayload(rawText);
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const candidateIdSet = new Set((candidateProducts || []).map((product) => product.id));

    const reply = stripTechnicalIdentifiers(payload.reply || payload.message || '');
    const followUpQuestion = stripTechnicalIdentifiers(payload.followUpQuestion || '');

    const recommendations = Array.isArray(payload.recommendations)
        ? payload.recommendations
            .map((entry) => ({
                productId: sanitizeText(entry?.productId),
                reason: sanitizeText(entry?.reason),
            }))
            .filter((entry) => entry.productId && candidateIdSet.has(entry.productId))
        : [];

    return {
        reply,
        followUpQuestion,
        recommendations,
    };
};

const mapRecommendationsToProducts = (recommendations, productPool) => {
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
        return [];
    }

    const byId = new Map((productPool || []).map((product) => [product.id, product]));
    const selected = [];

    recommendations.forEach((recommendation) => {
        const product = byId.get(recommendation.productId);
        if (product && !selected.find((entry) => entry.id === recommendation.productId)) {
            selected.push(product);
        }
    });

    return selected;
};

const buildFallbackAssistantMessage = (candidateProducts, slots) => {
    if (!candidateProducts || candidateProducts.length === 0) {
        return {
            reply: 'I can help with that. Share your preferred category, budget range, and style so I can narrow the best options.',
            followUpQuestion: 'What is your budget and preferred category?',
        };
    }

    const options = candidateProducts.slice(0, 3).map((product) => {
        const stock = getTotalStock(product);
        return `- ${product.name}: ${formatMoney(product.basePrice)} (${stock > 0 ? `${stock} in stock` : 'out of stock'})`;
    }).join('\n');

    const budgetLine = typeof slots?.maxPrice === 'number'
        ? ` under ${formatMoney(slots.maxPrice)}`
        : '';

    return {
        reply: `Here are strong matches${budgetLine}:\n${options}`,
        followUpQuestion: 'Do you want me to optimize for lowest price, premium quality, or fastest delivery?',
    };
};

const validateMessageSafety = (message) => {
    const cleanMessage = sanitizeText(message);

    if (!cleanMessage) {
        return {
            blocked: true,
            reason: 'empty',
            safeMessage: 'Please share what product you are looking for, and I will help right away.',
        };
    }

    if (cleanMessage.length > 500) {
        return {
            blocked: true,
            reason: 'too_long',
            safeMessage: 'That message is a bit long. Please send a shorter request with your category and budget.',
        };
    }

    if (BLOCKED_PATTERNS.some((pattern) => pattern.test(cleanMessage))) {
        return {
            blocked: true,
            reason: 'unsafe_content',
            safeMessage: 'I can only assist with shopping-related requests. Ask me about products, budget, or recommendations.',
        };
    }

    if (PROMPT_ATTACK_PATTERNS.some((pattern) => pattern.test(cleanMessage))) {
        return {
            blocked: true,
            reason: 'prompt_attack',
            safeMessage: 'I can help with shopping recommendations. Tell me what you want to buy and your budget.',
        };
    }

    return {
        blocked: false,
        reason: null,
        safeMessage: null,
    };
};

const enforceRapidMessageGuard = (conversation, cleanMessage) => {
    const now = Date.now();
    const tooFast = now - (conversation.lastUserMessageAt || 0) < MIN_GAP_BETWEEN_MESSAGES_MS;

    if (!tooFast) {
        conversation.lastUserMessageAt = now;
        return null;
    }

    const recentUserMessage = [...conversation.messages]
        .reverse()
        .find((entry) => entry.role === 'user')?.parts?.[0]?.text;

    const isDuplicate = sanitizeText(recentUserMessage).toLowerCase() === cleanMessage.toLowerCase();
    conversation.lastUserMessageAt = now;

    if (!isDuplicate) {
        return null;
    }

    return {
        message: 'I am still processing your previous request. Give me a second and ask again if needed.',
    };
};

const buildPromptPayload = ({ message, conversation, slots, candidates }) => {
    const recentHistory = (conversation.messages || [])
        .slice(-MAX_HISTORY_TURNS * 2)
        .map((entry) => ({
            role: entry.role,
            text: sanitizeText(entry.parts?.[0]?.text || ''),
        }))
        .filter((entry) => entry.text)
        .slice(-MAX_HISTORY_TURNS * 2);

    return {
        userMessage: sanitizeText(message),
        preferenceSlots: {
            category: slots.category,
            minPrice: slots.minPrice,
            maxPrice: slots.maxPrice,
            inStockOnly: slots.inStockOnly,
            sortBy: slots.sortBy,
            styleKeywords: slots.styleKeywords,
        },
        recentHistory,
        candidates: buildCandidateContext(candidates),
    };
};

const retrieveCandidateProducts = async (message, conversation, slots) => {
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
    let cacheHit = semanticCacheHit &&
        fulfilledPrimary.length > 0 &&
        fulfilledPrimary.every((result) => result.value.cacheHit === true);

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
        products: reranked.slice(0, MAX_CANDIDATE_PRODUCTS),
        cacheHit,
        semanticUsed,
    };
};

const generateAssistantResponse = async ({ message, conversation, slots, candidateProducts }) => {
    if (!process.env.GEMINI_API_KEY) {
        return buildFallbackAssistantMessage(candidateProducts, slots);
    }

    try {
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            systemInstruction: buildStructuredSystemPrompt(),
            generationConfig: {
                temperature: 0.35,
                topP: 0.9,
                maxOutputTokens: 320,
                responseMimeType: 'application/json',
            },
        });

        const promptPayload = buildPromptPayload({
            message,
            conversation,
            slots,
            candidates: candidateProducts,
        });

        const generation = await withTimeout(
            model.generateContent(JSON.stringify(promptPayload)),
            MODEL_TIMEOUT_MS,
            'AI model timeout'
        );

        const rawText = generation?.response?.text?.() || '';
        const parsed = parseModelResponse(rawText, candidateProducts);

        if (!parsed || (!parsed.reply && parsed.recommendations.length === 0)) {
            return buildFallbackAssistantMessage(candidateProducts, slots);
        }

        return {
            reply: parsed.reply,
            followUpQuestion: parsed.followUpQuestion,
            recommendations: parsed.recommendations,
        };
    } catch (error) {
        console.warn('AI generation failed, using fallback response:', error.message);
        return buildFallbackAssistantMessage(candidateProducts, slots);
    }
};

const ensureFinalMessage = (reply, followUpQuestion, candidateProducts, slots) => {
    const cleanReply = stripTechnicalIdentifiers(reply || '');

    if (cleanReply) {
        return normalizeMultiLineText(cleanReply);
    }

    const fallback = buildFallbackAssistantMessage(candidateProducts, slots);
    return normalizeMultiLineText(fallback.reply);
};

const chat = async (userId, message, conversationId = null) => {
    const startedAt = Date.now();
    const convId = conversationId || uuidv4();

    try {
        const cleanMessage = sanitizeText(message);
        const safety = validateMessageSafety(cleanMessage);

        const conversation = await loadConversation(convId, userId);

        if (safety.blocked) {
            conversation.messages.push({
                role: 'user',
                parts: [{ text: cleanMessage }],
            });
            conversation.messages.push({
                role: 'model',
                parts: [{ text: safety.safeMessage }],
            });
            conversation.updatedAt = new Date();
            await persistConversation(conversation);
            cleanupConversations();

            return {
                message: safety.safeMessage,
                products: [],
                conversationId: convId,
                followUpQuestion: null,
                appliedFilters: getAppliedFilters(conversation.preferenceSlots),
                latencyMs: Date.now() - startedAt,
                cacheHit: false,
                safetyBlocked: true,
            };
        }

        const rapidGuard = enforceRapidMessageGuard(conversation, cleanMessage);
        if (rapidGuard) {
            return {
                message: rapidGuard.message,
                products: [],
                conversationId: convId,
                followUpQuestion: null,
                appliedFilters: getAppliedFilters(conversation.preferenceSlots),
                latencyMs: Date.now() - startedAt,
                cacheHit: false,
                safetyBlocked: false,
            };
        }

        const categories = await fetchCategories();
        const slots = extractPreferenceSlots(cleanMessage, categories, conversation.preferenceSlots);

        conversation.messages.push({
            role: 'user',
            parts: [{ text: cleanMessage }],
        });
        conversation.preferenceSlots = slots;

        const previousRetrievedProducts = conversation.lastRetrievedProducts || [];

        const retrieval = await retrieveCandidateProducts(cleanMessage, conversation, slots);
        const candidateProducts = retrieval.products;
        console.log(`Chat retrieval produced ${candidateProducts.length} candidate products`);

        const generated = await generateAssistantResponse({
            message: cleanMessage,
            conversation,
            slots,
            candidateProducts,
        });

        let recommendedProducts = mapRecommendationsToProducts(
            generated.recommendations,
            candidateProducts
        );

        if (recommendedProducts.length === 0) {
            recommendedProducts = candidateProducts.slice(0, 4);
        }

        const finalFollowUpQuestion = sanitizeText(generated.followUpQuestion || '');
        const finalMessage = ensureFinalMessage(
            generated.reply,
            finalFollowUpQuestion,
            candidateProducts,
            slots
        );

        conversation.messages.push({
            role: 'model',
            parts: [{ text: finalMessage }],
        });

        const productPool = mergeUniqueProducts([candidateProducts, previousRetrievedProducts, recommendedProducts]);
        conversation.lastRetrievedProducts = productPool.slice(0, MAX_CANDIDATE_PRODUCTS);
        conversation.updatedAt = new Date();

        await persistConversation(conversation);
        cleanupConversations();

        return {
            message: finalMessage,
            products: recommendedProducts,
            conversationId: convId,
            followUpQuestion: finalFollowUpQuestion || null,
            appliedFilters: getAppliedFilters(slots),
            latencyMs: Date.now() - startedAt,
            cacheHit: retrieval.cacheHit,
            safetyBlocked: false,
            semanticUsed: Boolean(retrieval.semanticUsed),
        };
    } catch (error) {
        console.error('Chatbot error:', error);

        return {
            message: 'I hit a temporary issue while generating recommendations. Please try again, or tell me your category and budget for a quick fallback.',
            products: [],
            conversationId: convId,
            followUpQuestion: 'What category and budget should I optimize for?',
            appliedFilters: [],
            latencyMs: Date.now() - startedAt,
            cacheHit: false,
            safetyBlocked: false,
            semanticUsed: false,
        };
    }
};

const getConversation = async (conversationId) => {
    if (!conversationId) {
        return null;
    }

    if (conversations.has(conversationId)) {
        return conversations.get(conversationId);
    }

    const cached = await cacheService.getJson(buildConversationCacheKey(conversationId));
    if (!cached) {
        return null;
    }

    const conversation = deserializeConversation(cached, conversationId, cached.userId || 'unknown');
    conversations.set(conversationId, conversation);
    return conversation;
};

const clearConversation = async (conversationId) => {
    conversations.delete(conversationId);
    await cacheService.delete(buildConversationCacheKey(conversationId));
    return true;
};

const getProductCatalog = async () => {
    try {
        const result = await fetchProductsWithCache({
            search: null,
            category: null,
            minPrice: null,
            maxPrice: null,
            inStockOnly: false,
            sortBy: 'NEWEST',
            limit: 50,
            offset: 0,
        });

        return result.products;
    } catch (error) {
        console.error('Failed to fetch product catalog:', error.message);
        return [];
    }
};

module.exports = {
    chat,
    getConversation,
    clearConversation,
    getProductCatalog,
};
