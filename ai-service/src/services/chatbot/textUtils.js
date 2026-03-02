/**
 * Common text and numeric helpers used by chatbot flows.
 */

/**
 * Normalizes text input for downstream processing.
 * @param {unknown} value Input value.
 * @return {string} Trimmed single-spaced text.
 */
function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes multiline text without excessive blank lines.
 * @param {unknown} value Input text.
 * @return {string} Normalized text.
 */
function normalizeMultiLineText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Removes technical identifiers from user-facing text.
 * @param {unknown} value Raw text.
 * @return {string} Cleaned text.
 */
function stripTechnicalIdentifiers(value) {
  return normalizeMultiLineText(
    String(value || '')
      .replace(/\(ID:\s*[A-Za-z0-9-]+\)/gi, '')
      .replace(/\bID:\s*[A-Za-z0-9-]+\b/gi, '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '')
  );
}

/**
 * Parses numbers from loose user input.
 * @param {unknown} value Input value.
 * @return {number|null} Parsed number.
 */
function parseNumericValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).replace(/[$,]/g, '').trim();
  const numericValue = Number.parseFloat(normalized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

/**
 * Formats a numeric amount as USD-like money string.
 * @param {unknown} value Amount value.
 * @return {string} Currency string.
 */
function formatMoney(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '$0.00';
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Computes total stock from variant list.
 * @param {object} product Product payload.
 * @return {number} Total stock.
 */
function getTotalStock(product) {
  return (product?.variants || []).reduce((sum, variant) => {
    return sum + (typeof variant.stock === 'number' ? variant.stock : 0);
  }, 0);
}

/**
 * Clamps a numeric value within a range.
 * @param {number} value Input value.
 * @param {number} min Minimum bound.
 * @param {number} max Maximum bound.
 * @return {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Wraps a promise with timeout behavior.
 * @template T
 * @param {Promise<T>} promise Input promise.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @param {string} timeoutMessage Timeout error message.
 * @return {Promise<T>} Resolved promise or timeout rejection.
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
 * Converts a value to a compact cache-key-safe segment.
 * @param {unknown} value Input value.
 * @return {string} Key segment.
 */
function cacheKeyPart(value) {
  if (value === undefined || value === null) {
    return 'null';
  }
  return encodeURIComponent(String(value).toLowerCase().slice(0, 120));
}

module.exports = {
  cacheKeyPart,
  clamp,
  formatMoney,
  getTotalStock,
  normalizeMultiLineText,
  parseNumericValue,
  sanitizeText,
  stripTechnicalIdentifiers,
  withTimeout,
};
