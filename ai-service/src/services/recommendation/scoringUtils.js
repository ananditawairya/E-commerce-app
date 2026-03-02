/**
 * Shared utility helpers for recommendation scoring.
 */

/**
 * Restricts a numeric value to a closed interval.
 * @param {number} value Raw value.
 * @param {number} min Minimum value.
 * @param {number} max Maximum value.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalizes category text to lowercase trimmed string.
 * @param {unknown} value Category source.
 * @return {string} Normalized category string.
 */
function normalizeCategoryValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * Tokenizes category label to alphanumeric words.
 * @param {unknown} value Category label.
 * @return {string[]} Category tokens.
 */
function tokenizeCategory(value) {
  return normalizeCategoryValue(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Computes soft similarity between two category values.
 * @param {unknown} sourceCategory Source category.
 * @param {unknown} candidateCategory Candidate category.
 * @return {number} Similarity score from 0..1.
 */
function computeCategorySimilarity(sourceCategory, candidateCategory) {
  const source = normalizeCategoryValue(sourceCategory);
  const candidate = normalizeCategoryValue(candidateCategory);

  if (!source || !candidate) {
    return 0;
  }
  if (source === candidate) {
    return 1;
  }
  if (source.includes(candidate) || candidate.includes(source)) {
    return 0.75;
  }

  const sourceTokens = new Set(tokenizeCategory(source));
  const candidateTokens = tokenizeCategory(candidate);
  if (sourceTokens.size === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const commonTokenCount = candidateTokens.reduce((count, token) => {
    return sourceTokens.has(token) ? count + 1 : count;
  }, 0);
  const overlapRatio = commonTokenCount / Math.max(sourceTokens.size, candidateTokens.length);
  return clamp(overlapRatio * 0.7, 0, 0.7);
}

/**
 * Normalizes a value against a max value.
 * @param {number} value Raw value.
 * @param {number} maxValue Max denominator.
 * @return {number} Normalized ratio from 0..1.
 */
function normalizeByMax(value, maxValue) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  return clamp(value / maxValue, 0, 1);
}

/**
 * Normalizes integer limits with fallback and upper bound.
 * @param {unknown} limit Input limit.
 * @param {number} fallback Fallback value.
 * @param {number} max Max value.
 * @return {number} Normalized limit.
 */
function normalizeLimit(limit, fallback = 10, max = 50) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

module.exports = {
  clamp,
  computeCategorySimilarity,
  normalizeByMax,
  normalizeCategoryValue,
  normalizeLimit,
};
