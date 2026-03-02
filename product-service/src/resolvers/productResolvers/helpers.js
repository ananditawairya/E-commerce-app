/**
 * Normalizes id-like values into GraphQL ID strings.
 * @param {unknown} value Raw id value.
 * @return {string|null} Normalized ID or null when unavailable.
 */
function normalizeId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value && typeof value.toString === 'function') {
    const stringValue = value.toString();
    return typeof stringValue === 'string' && stringValue.trim()
      ? stringValue
      : null;
  }

  return null;
}

/**
 * Extracts an error message from axios or generic errors.
 * @param {unknown} error Error payload.
 * @return {string} Error message.
 */
function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || 'Unknown error';
}

/**
 * Retrieves parent product object from variant field resolver info.
 * @param {object} info GraphQL resolver info.
 * @return {object|null} Parent product when available.
 */
function getParentProductFromVariantInfo(info) {
  return info.path.prev && info.path.prev.key === 'variants'
    ? info.path.prev.prev.result
    : null;
}

module.exports = {
  getErrorMessage,
  getParentProductFromVariantInfo,
  normalizeId,
};
