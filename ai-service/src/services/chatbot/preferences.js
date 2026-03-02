const { STOP_WORDS } = require('./config');
const { formatMoney, parseNumericValue, sanitizeText } = require('./textUtils');

/**
 * Extracts min/max price constraints from a user message.
 * @param {string} message User message.
 * @return {{minPrice: number|null, maxPrice: number|null}} Parsed price range.
 */
function parsePriceConstraints(message) {
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
}

/**
 * Extracts keyword tokens from a user message.
 * @param {string} message User message.
 * @param {number=} maxTokens Maximum token count.
 * @return {string[]} Keyword tokens.
 */
function extractKeywordTokens(message, maxTokens = 10) {
  const cleaned = sanitizeText(message)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');

  return cleaned
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token))
    .slice(0, maxTokens);
}

/**
 * Builds a keyword query string from extracted tokens.
 * @param {string} message User message.
 * @param {number=} maxTokens Maximum token count.
 * @return {string} Joined keyword query.
 */
function extractKeywordQuery(message, maxTokens = 10) {
  return extractKeywordTokens(message, maxTokens).join(' ');
}

/**
 * Detects category mention from user message.
 * @param {string} message User message.
 * @param {string[]} categories Category list.
 * @return {string|null} Matched category.
 */
function detectCategory(message, categories) {
  const text = sanitizeText(message).toLowerCase();
  if (!text || !Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const sorted = [...categories].sort((a, b) => String(b).length - String(a).length);
  const matched = sorted.find((category) => text.includes(String(category).toLowerCase()));
  return matched || null;
}

/**
 * Detects requested sort preference from message text.
 * @param {string} message User message.
 * @return {string|null} Sort enum or null.
 */
function detectSortPreference(message) {
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
}

/**
 * Detects in-stock-only preference.
 * @param {string} message User message.
 * @return {boolean|null} Preference value.
 */
function detectInStockOnlyPreference(message) {
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
}

/**
 * Merges product lists and removes duplicates by id.
 * @param {Array<object[]>} productLists Product arrays.
 * @return {object[]} Deduplicated product list.
 */
function mergeUniqueProducts(productLists) {
  const byId = new Map();

  for (const list of productLists) {
    for (const product of list || []) {
      if (product?.id && !byId.has(product.id)) {
        byId.set(product.id, product);
      }
    }
  }

  return Array.from(byId.values());
}

/**
 * Creates default preference slots.
 * @return {{
 *   category: string|null,
 *   minPrice: number|null,
 *   maxPrice: number|null,
 *   inStockOnly: boolean,
 *   sortBy: string,
 *   styleKeywords: string[],
 * }} Default slot state.
 */
function createDefaultPreferenceSlots() {
  return {
    category: null,
    minPrice: null,
    maxPrice: null,
    inStockOnly: true,
    sortBy: 'RELEVANCE',
    styleKeywords: [],
  };
}

/**
 * Merges prior and new slot values.
 * @param {object} previousSlots Existing slot state.
 * @param {object} newSlots Next slot updates.
 * @return {object} Merged slot state.
 */
function mergePreferenceSlots(previousSlots, newSlots) {
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
}

/**
 * Derives style keywords after category extraction.
 * @param {string} message User message.
 * @param {string|null} detectedCategory Matched category.
 * @return {string[]} Style keywords.
 */
function deriveStyleKeywords(message, detectedCategory) {
  return extractKeywordTokens(message, 8)
    .filter((token) => token !== String(detectedCategory || '').toLowerCase());
}

/**
 * Extracts all preference slots from user message.
 * @param {string} message User message.
 * @param {string[]} categories Known categories.
 * @param {object=} existingSlots Existing slots.
 * @return {object} Updated slots.
 */
function extractPreferenceSlots(message, categories, existingSlots) {
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
}

/**
 * Builds human-readable applied-filter labels.
 * @param {object} slots Preference slots.
 * @return {string[]} Applied filter labels.
 */
function getAppliedFilters(slots) {
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
}

module.exports = {
  createDefaultPreferenceSlots,
  detectCategory,
  detectInStockOnlyPreference,
  detectSortPreference,
  extractKeywordQuery,
  extractKeywordTokens,
  extractPreferenceSlots,
  getAppliedFilters,
  mergePreferenceSlots,
  mergeUniqueProducts,
  parsePriceConstraints,
};
