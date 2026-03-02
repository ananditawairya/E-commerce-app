/**
 * Parses positive integer limit with clamping.
 * @param {unknown} value Input value.
 * @param {number=} fallback Default value.
 * @param {number=} max Max cap.
 * @return {number} Parsed limit.
 */
function parseLimit(value, fallback = 10, max = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/**
 * Parses optional numeric value.
 * @param {unknown} value Input value.
 * @return {number|null} Parsed number or null.
 */
function parseMaybeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses boolean value from typical API query/body values.
 * @param {unknown} value Input value.
 * @param {boolean=} fallback Fallback value.
 * @return {boolean} Parsed boolean.
 */
function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(lowered)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(lowered)) {
      return false;
    }
  }

  return fallback;
}

module.exports = {
  parseBoolean,
  parseLimit,
  parseMaybeNumber,
};
