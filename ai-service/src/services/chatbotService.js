const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const ProductScore = require('../models/ProductScore');
const cacheService = require('./cacheService');
const semanticSearchService = require('./semanticSearchService');
const {
  CATEGORY_CACHE_TTL_MS,
  CHAT_RESPONSE_SCHEMA,
  CONVERSATION_CACHE_TTL_MS,
  INTERNAL_JWT_SECRET,
  LEGACY_COMPATIBILITY_ERROR_PATTERN,
  MAX_CANDIDATE_PRODUCTS,
  MAX_CONVERSATION_MEMORY,
  MAX_HISTORY_TURNS,
  MAX_PRODUCTS_IN_PROMPT,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_NAME,
  MODEL_RETRY_MAX_OUTPUT_TOKENS,
  MODEL_TIMEOUT_MS,
  PRODUCT_FETCH_TIMEOUT_MS,
  PRODUCT_SERVICE_URL,
  RETRIEVAL_CACHE_TTL_MS,
} = require('./chatbot/config');
const {
  cacheKeyPart,
  formatMoney,
  getTotalStock,
  normalizeMultiLineText,
  sanitizeText,
  stripTechnicalIdentifiers,
  withTimeout,
} = require('./chatbot/textUtils');
const {
  createDefaultPreferenceSlots,
  extractKeywordQuery,
  extractPreferenceSlots,
  getAppliedFilters,
  mergePreferenceSlots,
  mergeUniqueProducts,
} = require('./chatbot/preferences');
const {
  enforceRapidMessageGuard,
  isLowIntentMessage,
  validateMessageSafety,
} = require('./chatbot/safety');
const { createConversationStore } = require('./chatbot/conversationStore');
const { createRankingTools } = require('./chatbot/ranking');
const { createProductGateway } = require('./chatbot/productGateway');
const { createRetrievalTools } = require('./chatbot/retrieval');
const { createModelResponseTools } = require('./chatbot/modelResponse');

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const productGateway = createProductGateway({
  axios,
  jwt,
  cacheService,
  config: {
    categoryCacheTtlMs: CATEGORY_CACHE_TTL_MS,
    internalJwtSecret: INTERNAL_JWT_SECRET,
    legacyCompatibilityErrorPattern: LEGACY_COMPATIBILITY_ERROR_PATTERN,
    productFetchTimeoutMs: PRODUCT_FETCH_TIMEOUT_MS,
    productServiceUrl: PRODUCT_SERVICE_URL,
    retrievalCacheTtlMs: RETRIEVAL_CACHE_TTL_MS,
  },
  textUtils: {
    cacheKeyPart,
    getTotalStock,
    sanitizeText,
  },
});

const rankingTools = createRankingTools({
  ProductScore,
  maxCandidateProducts: MAX_CANDIDATE_PRODUCTS,
  maxProductsInPrompt: MAX_PRODUCTS_IN_PROMPT,
});

const conversationStore = createConversationStore({
  cacheService,
  conversationCacheTtlMs: CONVERSATION_CACHE_TTL_MS,
  maxConversationMemory: MAX_CONVERSATION_MEMORY,
  createDefaultPreferenceSlots,
  mergePreferenceSlots,
});

const retrievalTools = createRetrievalTools({
  fetchProductsByIds: productGateway.fetchProductsByIds,
  fetchProductsWithCache: productGateway.fetchProductsWithCache,
  extractKeywordQuery,
  mergeUniqueProducts,
  rerankProducts: rankingTools.rerankProducts,
  sanitizeText,
  semanticSearchService,
  maxCandidateProducts: MAX_CANDIDATE_PRODUCTS,
});

const modelResponseTools = createModelResponseTools({
  genAI,
  config: {
    chatResponseSchema: CHAT_RESPONSE_SCHEMA,
    modelMaxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
    modelName: MODEL_NAME,
    modelRetryMaxOutputTokens: MODEL_RETRY_MAX_OUTPUT_TOKENS,
    modelTimeoutMs: MODEL_TIMEOUT_MS,
  },
  tools: {
    buildCandidateContext: rankingTools.buildCandidateContext,
    formatMoney,
    getTotalStock,
    normalizeMultiLineText,
    sanitizeText,
    stripTechnicalIdentifiers,
    withTimeout,
  },
  maxHistoryTurns: MAX_HISTORY_TURNS,
});

/**
 * Handles one user chat turn and returns response payload.
 * @param {string} userId Authenticated user id.
 * @param {string} message User message.
 * @param {string|null=} conversationId Existing conversation id.
 * @return {Promise<{
 *   message: string,
 *   products: object[],
 *   conversationId: string,
 *   followUpQuestion: string|null,
 *   appliedFilters: string[],
 *   latencyMs: number,
 *   cacheHit: boolean,
 *   safetyBlocked: boolean,
 *   semanticUsed?: boolean,
 * }>} Chat response payload.
 */
async function chat(userId, message, conversationId = null) {
  const startedAt = Date.now();
  const convId = conversationId || uuidv4();

  try {
    const cleanMessage = sanitizeText(message);
    const safety = validateMessageSafety(cleanMessage);

    const conversation = await conversationStore.loadConversation(convId, userId);

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
      await conversationStore.persistConversation(conversation);
      conversationStore.cleanupConversations();

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

    if (isLowIntentMessage(cleanMessage)) {
      const prompt = 'Tell me the product type and budget, for example: "casual shirts under $50".';
      conversation.messages.push({
        role: 'model',
        parts: [{ text: prompt }],
      });
      conversation.updatedAt = new Date();
      await conversationStore.persistConversation(conversation);

      return {
        message: prompt,
        products: [],
        conversationId: convId,
        followUpQuestion: 'What category and budget should I target?',
        appliedFilters: getAppliedFilters(conversation.preferenceSlots),
        latencyMs: Date.now() - startedAt,
        cacheHit: false,
        safetyBlocked: false,
        semanticUsed: false,
      };
    }

    const categories = await productGateway.fetchCategories();
    const slots = extractPreferenceSlots(cleanMessage, categories, conversation.preferenceSlots);

    conversation.messages.push({
      role: 'user',
      parts: [{ text: cleanMessage }],
    });
    conversation.preferenceSlots = slots;

    const previousRetrievedProducts = conversation.lastRetrievedProducts || [];

    const retrieval = await retrievalTools.retrieveCandidateProducts(cleanMessage, conversation, slots);
    const candidateProducts = retrieval.products;
    console.log(`Chat retrieval produced ${candidateProducts.length} candidate products`);

    const generated = await modelResponseTools.generateAssistantResponse({
      message: cleanMessage,
      conversation,
      slots,
      candidateProducts,
    });

    let recommendedProducts = rankingTools.mapRecommendationsToProducts(
      generated.recommendations,
      candidateProducts
    );

    if (recommendedProducts.length === 0) {
      recommendedProducts = candidateProducts.slice(0, 4);
    }

    const finalFollowUpQuestion = sanitizeText(generated.followUpQuestion || '');
    const finalMessage = modelResponseTools.ensureFinalMessage(
      generated.reply,
      finalFollowUpQuestion,
      candidateProducts,
      slots
    );

    conversation.messages.push({
      role: 'model',
      parts: [{ text: finalMessage }],
    });

    const productPool = mergeUniqueProducts([
      candidateProducts,
      previousRetrievedProducts,
      recommendedProducts,
    ]);
    conversation.lastRetrievedProducts = productPool.slice(0, MAX_CANDIDATE_PRODUCTS);
    conversation.updatedAt = new Date();

    await conversationStore.persistConversation(conversation);
    conversationStore.cleanupConversations();

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
}

/**
 * Returns one conversation payload by id.
 * @param {string} conversationId Conversation id.
 * @return {Promise<object|null>} Conversation payload.
 */
async function getConversation(conversationId) {
  return conversationStore.getConversation(conversationId);
}

/**
 * Clears one conversation from memory and cache.
 * @param {string} conversationId Conversation id.
 * @return {Promise<boolean>} True when cleared.
 */
async function clearConversation(conversationId) {
  return conversationStore.clearConversation(conversationId);
}

/**
 * Returns cached product catalog used by chatbot features.
 * @return {Promise<object[]>} Product list.
 */
async function getProductCatalog() {
  try {
    const result = await productGateway.fetchProductsWithCache({
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
}

module.exports = {
  chat,
  clearConversation,
  getConversation,
  getProductCatalog,
};
