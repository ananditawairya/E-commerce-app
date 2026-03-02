const { SchemaType } = require('@google/generative-ai');

/**
 * Product service endpoint used by chatbot retrieval.
 * @type {string}
 */
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';

/**
 * Shared secret for internal service-to-service token generation.
 * @type {string}
 */
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

/**
 * Category cache TTL in milliseconds.
 * @type {number}
 */
const CATEGORY_CACHE_TTL_MS = Number.parseInt(process.env.CATEGORY_CACHE_TTL_MS || '300000', 10);

/**
 * Product fetch timeout in milliseconds.
 * @type {number}
 */
const PRODUCT_FETCH_TIMEOUT_MS = Number.parseInt(process.env.AI_PRODUCT_FETCH_TIMEOUT_MS || '6000', 10);

/**
 * Retrieval cache TTL in milliseconds.
 * @type {number}
 */
const RETRIEVAL_CACHE_TTL_MS = Number.parseInt(process.env.AI_RETRIEVAL_CACHE_TTL_MS || '90000', 10);

/**
 * Conversation cache TTL in milliseconds.
 * @type {number}
 */
const CONVERSATION_CACHE_TTL_MS = Number.parseInt(process.env.AI_CONVERSATION_CACHE_TTL_MS || '3600000', 10);

/**
 * AI model timeout in milliseconds.
 * @type {number}
 */
const MODEL_TIMEOUT_MS = Number.parseInt(process.env.AI_MODEL_TIMEOUT_MS || '9000', 10);

/**
 * Maximum candidate products considered for chat ranking.
 * @type {number}
 */
const MAX_CANDIDATE_PRODUCTS = Number.parseInt(process.env.AI_CHAT_MAX_CANDIDATES || '16', 10);

/**
 * Maximum products included in model prompt context.
 * @type {number}
 */
const MAX_PRODUCTS_IN_PROMPT = Number.parseInt(process.env.AI_CHAT_PROMPT_PRODUCTS || '10', 10);

/**
 * Maximum history turns included in prompt context.
 * @type {number}
 */
const MAX_HISTORY_TURNS = Number.parseInt(process.env.AI_CHAT_HISTORY_TURNS || '4', 10);

/**
 * Maximum in-memory conversations retained.
 * @type {number}
 */
const MAX_CONVERSATION_MEMORY = Number.parseInt(process.env.AI_CHAT_CONVERSATION_MEMORY || '300', 10);

/**
 * Minimum allowed gap between duplicate user messages.
 * @type {number}
 */
const MIN_GAP_BETWEEN_MESSAGES_MS = Number.parseInt(process.env.AI_CHAT_MIN_MESSAGE_GAP_MS || '400', 10);

/**
 * Gemini model name used by chatbot generation.
 * @type {string}
 */
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Default model output token budget.
 * @type {number}
 */
const MODEL_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.AI_CHAT_MAX_OUTPUT_TOKENS || '1536', 10);

/**
 * Retry model output token budget.
 * @type {number}
 */
const MODEL_RETRY_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.AI_CHAT_RETRY_MAX_OUTPUT_TOKENS || '2200', 10);

/**
 * Response schema enforced for chatbot model output.
 */
const CHAT_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  required: ['reply', 'recommendations', 'followUpQuestion'],
  properties: {
    reply: {
      type: SchemaType.STRING,
    },
    recommendations: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ['productId', 'reason'],
        properties: {
          productId: {
            type: SchemaType.STRING,
          },
          reason: {
            type: SchemaType.STRING,
          },
        },
      },
    },
    followUpQuestion: {
      type: SchemaType.STRING,
    },
  },
};

/**
 * Simple stop-word list used in keyword extraction.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'buy', 'can', 'do', 'for',
  'from', 'get', 'give', 'have', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'please', 'show', 'that', 'the', 'their', 'them', 'this', 'to', 'want',
  'with', 'you', 'your', 'something', 'need', 'any', 'some', 'tell', 'what', 'which',
]);

/**
 * Unsafe-content patterns blocked at request validation layer.
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS = [
  /\b(kill|murder|suicide|self-harm)\b/i,
  /\b(bomb|explosive|weapon)\b/i,
  /\b(hate\s+speech|racist\s+slur)\b/i,
];

/**
 * Prompt-injection or jailbreak pattern set.
 * @type {RegExp[]}
 */
const PROMPT_ATTACK_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /reveal\s+(your\s+)?(system|developer)\s+prompt/i,
  /show\s+(hidden|internal)\s+instructions/i,
  /act\s+as\s+system/i,
];

/**
 * Pattern used to detect compatibility errors between schema versions.
 * @type {RegExp}
 */
const LEGACY_COMPATIBILITY_ERROR_PATTERN = /Unknown argument|Unknown type|Cannot query field|is not defined by type/i;

/**
 * Low-intent messages that should trigger clarification.
 * @type {Set<string>}
 */
const LOW_INTENT_MESSAGES = new Set([
  'hi', 'hii', 'hiii', 'hello', 'hey', 'yo', 'sup', 'hola', 'namaste',
  'ok', 'okay', 'hmm', 'hmmm',
]);

module.exports = {
  BLOCKED_PATTERNS,
  CATEGORY_CACHE_TTL_MS,
  CHAT_RESPONSE_SCHEMA,
  CONVERSATION_CACHE_TTL_MS,
  INTERNAL_JWT_SECRET,
  LEGACY_COMPATIBILITY_ERROR_PATTERN,
  LOW_INTENT_MESSAGES,
  MAX_CANDIDATE_PRODUCTS,
  MAX_CONVERSATION_MEMORY,
  MAX_HISTORY_TURNS,
  MAX_PRODUCTS_IN_PROMPT,
  MIN_GAP_BETWEEN_MESSAGES_MS,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_NAME,
  MODEL_RETRY_MAX_OUTPUT_TOKENS,
  MODEL_TIMEOUT_MS,
  PRODUCT_FETCH_TIMEOUT_MS,
  PRODUCT_SERVICE_URL,
  PROMPT_ATTACK_PATTERNS,
  RETRIEVAL_CACHE_TTL_MS,
  STOP_WORDS,
};
