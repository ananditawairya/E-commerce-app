const express = require('express');

const recommendationService = require('../../services/recommendationService');
const semanticSearchService = require('../../services/semanticSearchService');
const { requireSellerRestUser, requireInternalService } = require('../../middleware/auth');
const { createRecommendationHandlers } = require('./recommendation/handlers');

const publicRecommendationRouter = express.Router();
const adminRecommendationRouter = express.Router();
const internalRecommendationRouter = express.Router();

const handlers = createRecommendationHandlers({
  recommendationService,
  semanticSearchService,
});

// Public/user-facing routes
publicRecommendationRouter.get('/similar/:productId', handlers.getSimilarProducts);
publicRecommendationRouter.get('/trending', handlers.getTrendingProducts);
publicRecommendationRouter.get('/recent/:userId', handlers.getRecentlyViewed);
publicRecommendationRouter.get('/:userId', handlers.getRecommendations);

// Admin/operational routes
adminRecommendationRouter.use(requireSellerRestUser);
adminRecommendationRouter.get('/semantic/status', handlers.getSemanticStatus);
adminRecommendationRouter.post('/semantic/reindex', handlers.reindexSemantic);
adminRecommendationRouter.post('/semantic/invalidate', handlers.invalidateSemantic);
adminRecommendationRouter.get('/semantic/search', handlers.searchSemantic);

// Internal service routes
internalRecommendationRouter.use(requireInternalService);
internalRecommendationRouter.post('/track', handlers.trackEvent);

module.exports = {
  publicRecommendationRouter,
  adminRecommendationRouter,
  internalRecommendationRouter,
};
