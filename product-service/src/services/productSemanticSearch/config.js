const SEARCH_SEMANTIC_ENABLED = String(process.env.SEARCH_SEMANTIC_ENABLED || 'false')
  .toLowerCase() === 'true';
const SEARCH_SEMANTIC_MAX_PRODUCTS = Number.parseInt(
  process.env.SEARCH_SEMANTIC_MAX_PRODUCTS || '800',
  10
);
const SEARCH_SEMANTIC_MIN_SCORE = Number.parseFloat(
  process.env.SEARCH_SEMANTIC_MIN_SCORE || '0.18'
);

/**
 * Returns whether semantic search is active in current runtime.
 * @param {{isEnabled: () => boolean}} localEmbeddingService Embedding adapter.
 * @return {boolean} True when semantic path is enabled.
 */
function isSemanticEnabled(localEmbeddingService) {
  return Boolean(SEARCH_SEMANTIC_ENABLED && localEmbeddingService.isEnabled());
}

module.exports = {
  SEARCH_SEMANTIC_MAX_PRODUCTS,
  SEARCH_SEMANTIC_MIN_SCORE,
  isSemanticEnabled,
};
