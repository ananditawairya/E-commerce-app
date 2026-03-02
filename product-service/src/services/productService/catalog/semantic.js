/**
 * Fetches semantic search status.
 * @param {{productSemanticSearchService: object}} deps Dependencies.
 * @return {Promise<object>} Status payload.
 */
function getSemanticSearchStatus({ productSemanticSearchService }) {
  return productSemanticSearchService.getStatus();
}

/**
 * Reindexes semantic product vectors.
 * @param {{productSemanticSearchService: object}} deps Dependencies.
 * @return {Promise<object>} Reindex summary.
 */
function reindexSemanticSearch({ productSemanticSearchService }) {
  return productSemanticSearchService.reindexAllActiveProducts();
}

module.exports = {
  getSemanticSearchStatus,
  reindexSemanticSearch,
};
