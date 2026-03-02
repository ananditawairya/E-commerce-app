const {
  parseBoolean,
  parseLimit,
  parseMaybeNumber,
} = require('./parsers');

/**
 * Sends normalized server error payload and logs route error.
 * @param {import('express').Response} res Express response.
 * @param {Error} error Error object.
 * @param {string} message Log prefix message.
 * @return {void}
 */
function sendServerError(res, error, message) {
  console.error(message, error);
  res.status(500).json({
    success: false,
    error: error.message,
  });
}

/**
 * Creates recommendation route handlers.
 * @param {{
 *   recommendationService: object,
 *   semanticSearchService: object,
 * }} deps Dependencies.
 * @return {object} Route handlers.
 */
function createRecommendationHandlers({ recommendationService, semanticSearchService }) {
  return {
    /**
     * Handles semantic search status endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async getSemanticStatus(req, res) {
      try {
        res.json({
          success: true,
          data: semanticSearchService.getPublicStatus(),
        });
      } catch (error) {
        sendServerError(res, error, 'Error getting semantic status:');
      }
    },

    /**
     * Handles semantic reindex endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async reindexSemantic(req, res) {
      try {
        const force = parseBoolean(req.body?.force, true);
        const wait = parseBoolean(req.body?.wait, true);
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 80)
          : 'api_reindex';

        if (force && wait) {
          const status = await semanticSearchService.forceReindex(reason);
          res.json({
            success: true,
            message: 'Semantic index rebuilt',
            data: status,
          });
          return;
        }

        semanticSearchService.scheduleReindex(reason);
        res.status(202).json({
          success: true,
          message: 'Semantic reindex scheduled',
          data: semanticSearchService.getPublicStatus(),
        });
      } catch (error) {
        sendServerError(res, error, 'Error rebuilding semantic index:');
      }
    },

    /**
     * Handles semantic invalidate endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async invalidateSemantic(req, res) {
      try {
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 80)
          : 'api_invalidate';

        const status = await semanticSearchService.invalidateIndex(reason);
        res.json({
          success: true,
          message: 'Semantic index invalidated',
          data: status,
        });
      } catch (error) {
        sendServerError(res, error, 'Error invalidating semantic index:');
      }
    },

    /**
     * Handles semantic search debug endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async searchSemantic(req, res) {
      try {
        const query = String(req.query.q || '').trim();
        if (!query) {
          res.status(400).json({
            success: false,
            error: 'q query parameter is required',
          });
          return;
        }

        const limit = parseLimit(req.query.limit, 10, 30);
        const category = typeof req.query.category === 'string' && req.query.category.trim()
          ? req.query.category.trim()
          : null;
        const minPrice = parseMaybeNumber(req.query.minPrice);
        const maxPrice = parseMaybeNumber(req.query.maxPrice);
        const inStockOnly = parseBoolean(req.query.inStockOnly, true);

        const result = await semanticSearchService.search(query, {
          limit,
          category,
          minPrice,
          maxPrice,
          inStockOnly,
          includeScores: true,
        });

        res.json({
          success: true,
          data: result,
          status: semanticSearchService.getPublicStatus(),
        });
      } catch (error) {
        sendServerError(res, error, 'Error running semantic search:');
      }
    },

    /**
     * Handles similar products endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async getSimilarProducts(req, res) {
      try {
        const { productId } = req.params;
        const limit = parseLimit(req.query.limit, 10);
        const similar = await recommendationService.getSimilarProducts(productId, limit);

        res.json({
          success: true,
          data: similar,
          count: similar.length,
        });
      } catch (error) {
        sendServerError(res, error, 'Error getting similar products:');
      }
    },

    /**
     * Handles trending products endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async getTrendingProducts(req, res) {
      try {
        const category = req.query.category || null;
        const limit = parseLimit(req.query.limit, 10);
        const trending = await recommendationService.getTrendingProducts(category, limit);

        res.json({
          success: true,
          data: trending,
          count: trending.length,
        });
      } catch (error) {
        sendServerError(res, error, 'Error getting trending products:');
      }
    },

    /**
     * Handles recently-viewed endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async getRecentlyViewed(req, res) {
      try {
        const { userId } = req.params;
        const limit = parseLimit(req.query.limit, 10);
        const recentlyViewed = await recommendationService.getRecentlyViewed(userId, limit);

        res.json({
          success: true,
          data: recentlyViewed,
          count: recentlyViewed.length,
        });
      } catch (error) {
        sendServerError(res, error, 'Error getting recently viewed:');
      }
    },

    /**
     * Handles event tracking endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async trackEvent(req, res) {
      try {
        const {
          userId,
          productId,
          eventType,
          category,
          metadata,
        } = req.body;

        if (!userId || !productId || !eventType) {
          res.status(400).json({
            success: false,
            error: 'userId, productId, and eventType are required',
          });
          return;
        }

        const normalizedEventType = recommendationService.normalizeEventType(eventType);
        const validEventTypes = recommendationService.getValidEventTypes();

        if (!recommendationService.isValidEventType(normalizedEventType)) {
          res.status(400).json({
            success: false,
            error: `Invalid eventType. Valid types: ${validEventTypes.join(', ')}`,
          });
          return;
        }

        await recommendationService.trackEvent(
          userId,
          productId,
          normalizedEventType,
          category,
          metadata || {}
        );

        res.json({
          success: true,
          message: 'Event tracked successfully',
        });
      } catch (error) {
        sendServerError(res, error, 'Error tracking event:');
      }
    },

    /**
     * Handles personalized recommendation endpoint.
     * @param {import('express').Request} req Express request.
     * @param {import('express').Response} res Express response.
     * @return {Promise<void>} Completion promise.
     */
    async getRecommendations(req, res) {
      try {
        const { userId } = req.params;
        const limit = parseLimit(req.query.limit, 10);
        const recommendations = await recommendationService.getRecommendations(userId, limit);

        res.json({
          success: true,
          data: recommendations,
          count: recommendations.length,
        });
      } catch (error) {
        sendServerError(res, error, 'Error getting recommendations:');
      }
    },
  };
}

module.exports = {
  createRecommendationHandlers,
};
