const crypto = require('crypto');

/**
 * Sanitizes text for embedding and search.
 * @param {unknown} value Input value.
 * @return {string} Sanitized text.
 */
function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Clamps number into [min, max] range.
 * @param {number} value Input value.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Creates deterministic short hash for content.
 * @param {string} value Input string.
 * @return {string} Hex hash.
 */
function createHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Computes cosine similarity for normalized vectors.
 * @param {number[]} a Vector A.
 * @param {number[]} b Vector B.
 * @return {number} Similarity score.
 */
function cosineSimilarityNormalized(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
  }
  return dot;
}

/**
 * Normalizes a string list by trimming and deduping.
 * @param {unknown[]} values Candidate values.
 * @return {string[]} Normalized list.
 */
function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

/**
 * Builds semantic document text for one product.
 * @param {{
 *   name?: string,
 *   category?: string,
 *   description?: string,
 *   basePrice?: number,
 *   variants?: {name?: string}[],
 * }} product Product payload.
 * @return {string} Document text.
 */
function buildDocumentText(product) {
  const variantNames = (product.variants || [])
    .slice(0, 6)
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
 * Maps product doc to GraphQL output shape.
 * @param {object} product Product document.
 * @param {number} semanticScore Semantic score.
 * @return {object} Normalized product.
 */
function toPublicProduct(product, semanticScore) {
  const mapped = {
    ...product,
    id: product.id || product._id,
    semanticScore: Number(semanticScore.toFixed(4)),
  };
  delete mapped._id;
  delete mapped.__v;

  if (Array.isArray(mapped.variants)) {
    mapped.variants = mapped.variants.map((variant) => {
      const normalizedVariant = { ...variant, id: variant.id || variant._id };
      delete normalizedVariant._id;
      return normalizedVariant;
    });
  }

  return mapped;
}

module.exports = {
  buildDocumentText,
  clamp,
  cosineSimilarityNormalized,
  createHash,
  normalizeStringArray,
  sanitizeText,
  toPublicProduct,
};
