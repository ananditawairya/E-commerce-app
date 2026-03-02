const express = require('express');

const recommendationService = require('../../services/recommendationService');
const semanticSearchService = require('../../services/semanticSearchService');
const { createRecommendationHandlers } = require('./recommendation/handlers');

const router = express.Router();
const handlers = createRecommendationHandlers({
  recommendationService,
  semanticSearchService,
});

router.get('/semantic/status', handlers.getSemanticStatus);
router.post('/semantic/reindex', handlers.reindexSemantic);
router.post('/semantic/invalidate', handlers.invalidateSemantic);
router.get('/semantic/search', handlers.searchSemantic);

router.get('/similar/:productId', handlers.getSimilarProducts);
router.get('/trending', handlers.getTrendingProducts);
router.get('/recent/:userId', handlers.getRecentlyViewed);

router.post('/track', handlers.trackEvent);
router.get('/:userId', handlers.getRecommendations);

module.exports = router;
