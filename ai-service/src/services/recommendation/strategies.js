const { createCollaborativeStrategies } = require('./strategies/collaborative');
const { createSimilarityStrategies } = require('./strategies/similarity');

/**
 * Builds recommendation strategy functions.
 * @param {{
 *   UserBehavior: object,
 *   ProductScore: object,
 *   semanticSearchService: object,
 * }} deps Shared dependencies.
 * @return {object} Strategy method map.
 */
function createRecommendationStrategies(deps) {
  const collaborativeStrategies = createCollaborativeStrategies(deps);
  const similarityStrategies = createSimilarityStrategies(deps);

  return {
    ...collaborativeStrategies,
    ...similarityStrategies,
  };
}

module.exports = {
  createRecommendationStrategies,
};
