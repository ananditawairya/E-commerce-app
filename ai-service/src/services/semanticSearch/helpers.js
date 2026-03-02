const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const {
  INTERNAL_JWT_SECRET,
  PRODUCT_FETCH_TIMEOUT_MS,
  PRODUCT_SERVICE_URL,
} = require('./config');

/**
 * Normalizes a text value.
 * @param {unknown} value Source value.
 * @return {string} Trimmed normalized text.
 */
function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Builds internal auth headers for product-service GraphQL.
 * @return {object} Request headers.
 */
function buildInternalHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-internal-gateway-token': jwt.sign(
      { service: 'ai-service' },
      INTERNAL_JWT_SECRET,
      { expiresIn: '2m' }
    ),
  };
}

/**
 * Races a promise against a timeout.
 * @template T
 * @param {Promise<T>} promise Promise to resolve.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @param {string} timeoutMessage Timeout error message.
 * @return {Promise<T>} Promise result.
 */
async function withTimeout(promise, timeoutMs, timeoutMessage) {
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
}

/**
 * Executes product-service GraphQL query.
 * @param {string} query GraphQL query.
 * @param {object} variables Query variables.
 * @return {Promise<object>} GraphQL data payload.
 */
async function executeProductServiceQuery(query, variables = {}) {
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
}

/**
 * Normalizes a vector to unit length.
 * @param {unknown[]} values Raw vector values.
 * @return {number[]|null} Normalized vector.
 */
function normalizeVector(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const cleaned = values.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(cleaned.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return null;
  }

  return cleaned.map((value) => value / magnitude);
}

/**
 * Computes cosine similarity for normalized vectors.
 * @param {number[]} left Left vector.
 * @param {number[]} right Right vector.
 * @return {number} Similarity score.
 */
function cosineSimilarityNormalized(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }

  return dot;
}

/**
 * Computes total stock across product variants.
 * @param {object} product Product payload.
 * @return {number} Total stock.
 */
function getTotalStock(product) {
  return (product.variants || []).reduce((sum, variant) => {
    return sum + (typeof variant.stock === 'number' ? variant.stock : 0);
  }, 0);
}

/**
 * Builds product text payload for embedding generation.
 * @param {object} product Product payload.
 * @return {string} Embedding text.
 */
function buildProductDocumentText(product) {
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
}

/**
 * Creates short deterministic content hash.
 * @param {unknown} value Hash input.
 * @return {string} Short hash.
 */
function createTextHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 24);
}

/**
 * Builds cache key suffix scoped by model.
 * @param {string} baseKey Cache key base.
 * @param {string} modelName Model name.
 * @return {string|null} Scoped cache key.
 */
function buildModelScopedCacheKey(baseKey, modelName) {
  if (!baseKey) {
    return null;
  }
  return `${baseKey}:m:${createTextHash(modelName || 'unknown')}`;
}

/**
 * Detects unsupported embedding model errors.
 * @param {object} error Error payload.
 * @return {boolean} True when model is unavailable.
 */
function isEmbeddingModelUnavailableError(error) {
  const statusCode = Number.parseInt(error?.status, 10);
  if (statusCode === 404) {
    return true;
  }

  const message = sanitizeText(error?.message || '').toLowerCase();
  return message.includes('not found')
    || message.includes('not supported for embedcontent');
}

/**
 * Extracts a readable error message.
 * @param {object} error Error payload.
 * @return {string} Error message.
 */
function extractErrorMessage(error) {
  const directMessage = sanitizeText(error?.message || '');
  if (directMessage) {
    return directMessage;
  }

  const causeMessage = sanitizeText(error?.cause?.message || '');
  if (causeMessage) {
    return causeMessage;
  }

  const errorCode = sanitizeText(error?.code || error?.cause?.code || '');
  if (errorCode) {
    return errorCode;
  }

  return 'unknown error';
}

/**
 * Extracts lexically useful tokens.
 * @param {unknown} value Input text.
 * @return {string[]} Token list.
 */
function extractTokens(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

/**
 * Computes simple lexical overlap boost.
 * @param {string} queryText User query.
 * @param {object} product Product payload.
 * @return {number} Boost score from 0..1.
 */
function lexicalOverlapBoost(queryText, product) {
  const queryTokens = extractTokens(queryText);
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLowerCase();
  const hits = queryTokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
  return hits / queryTokens.length;
}

/**
 * Restricts a value to a range.
 * @param {number} value Raw value.
 * @param {number} min Minimum bound.
 * @param {number} max Maximum bound.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  buildModelScopedCacheKey,
  buildProductDocumentText,
  clamp,
  cosineSimilarityNormalized,
  createTextHash,
  executeProductServiceQuery,
  extractErrorMessage,
  getTotalStock,
  isEmbeddingModelUnavailableError,
  lexicalOverlapBoost,
  normalizeVector,
  sanitizeText,
  withTimeout,
};
