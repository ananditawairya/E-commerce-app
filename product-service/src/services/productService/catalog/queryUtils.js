/**
 * Shared query helper utilities for catalog operations.
 */

/**
 * Escapes regex special characters.
 * @param {string} input Raw value.
 * @return {string} Escaped value.
 */
function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes an array of string values.
 * @param {unknown} values Potential string array.
 * @return {string[]} Deduplicated, trimmed values.
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
 * Creates a stable JSON string.
 * @param {unknown} value Input value.
 * @return {string} Deterministic JSON string.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * Builds a MongoDB query sort definition.
 * @param {string} sortBy Requested sort value.
 * @param {boolean} hasTextSearch Whether text search is applied.
 * @return {{
 *   sortConfig: object,
 *   useCaseInsensitiveCollation: boolean,
 *   useTextScoreProjection: boolean,
 * }} Sort options.
 */
function resolveSortOptions(sortBy, hasTextSearch) {
  let sortConfig = { createdAt: -1 };
  let useCaseInsensitiveCollation = false;
  let useTextScoreProjection = false;

  switch (sortBy) {
    case 'RELEVANCE':
      if (hasTextSearch) {
        sortConfig = { score: { $meta: 'textScore' }, createdAt: -1 };
        useTextScoreProjection = true;
      }
      break;
    case 'PRICE_LOW_TO_HIGH':
      sortConfig = { basePrice: 1, createdAt: -1 };
      break;
    case 'PRICE_HIGH_TO_LOW':
      sortConfig = { basePrice: -1, createdAt: -1 };
      break;
    case 'NAME_A_TO_Z':
      sortConfig = { name: 1, createdAt: -1 };
      useCaseInsensitiveCollation = true;
      break;
    case 'NAME_Z_TO_A':
      sortConfig = { name: -1, createdAt: -1 };
      useCaseInsensitiveCollation = true;
      break;
    case 'NEWEST':
    default:
      break;
  }

  return {
    sortConfig,
    useCaseInsensitiveCollation,
    useTextScoreProjection,
  };
}

/**
 * Applies optional price bounds in-place on a query object.
 * @param {object} query Mongo query object.
 * @param {number|undefined} minPrice Minimum price.
 * @param {number|undefined} maxPrice Maximum price.
 * @return {void} No return value.
 */
function applyPriceFilter(query, minPrice, maxPrice) {
  const hasMinPrice = Number.isFinite(minPrice);
  const hasMaxPrice = Number.isFinite(maxPrice);
  if (!hasMinPrice && !hasMaxPrice) {
    return;
  }

  let safeMin = hasMinPrice ? Math.max(minPrice, 0) : undefined;
  let safeMax = hasMaxPrice ? Math.max(maxPrice, 0) : undefined;
  if (hasMinPrice && hasMaxPrice && safeMin > safeMax) {
    [safeMin, safeMax] = [safeMax, safeMin];
  }

  query.basePrice = {};
  if (Number.isFinite(safeMin)) {
    query.basePrice.$gte = safeMin;
  }
  if (Number.isFinite(safeMax)) {
    query.basePrice.$lte = safeMax;
  }
}

/**
 * Clamps a number into a min/max range.
 * @param {number} value Input value.
 * @param {number} min Minimum.
 * @param {number} max Maximum.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts unknown value to finite number.
 * @param {unknown} value Input value.
 * @param {number} fallback Fallback value.
 * @return {number} Number value.
 */
function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  applyPriceFilter,
  clamp,
  escapeRegExp,
  normalizeStringArray,
  resolveSortOptions,
  stableStringify,
  toFiniteNumber,
};
