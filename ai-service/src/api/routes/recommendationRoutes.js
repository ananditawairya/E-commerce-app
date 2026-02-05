// ai-service/src/api/routes/recommendationRoutes.js

const express = require('express');
const router = express.Router();
const recommendationService = require('../../services/recommendationService');

/**
 * GET /api/recommendations/:userId
 * Get personalized recommendations for a user
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const recommendations = await recommendationService.getRecommendations(userId, limit);

        res.json({
            success: true,
            data: recommendations,
            count: recommendations.length,
        });
    } catch (error) {
        console.error('Error getting recommendations:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/recommendations/similar/:productId
 * Get similar products
 */
router.get('/similar/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const similar = await recommendationService.getSimilarProducts(productId, limit);

        res.json({
            success: true,
            data: similar,
            count: similar.length,
        });
    } catch (error) {
        console.error('Error getting similar products:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/recommendations/trending
 * Get trending products
 */
router.get('/trending', async (req, res) => {
    try {
        const category = req.query.category || null;
        const limit = parseInt(req.query.limit) || 10;

        const trending = await recommendationService.getTrendingProducts(category, limit);

        res.json({
            success: true,
            data: trending,
            count: trending.length,
        });
    } catch (error) {
        console.error('Error getting trending products:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/recommendations/recent/:userId
 * Get recently viewed products
 */
router.get('/recent/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const recentlyViewed = await recommendationService.getRecentlyViewed(userId, limit);

        res.json({
            success: true,
            data: recentlyViewed,
            count: recentlyViewed.length,
        });
    } catch (error) {
        console.error('Error getting recently viewed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/recommendations/track
 * Track a user behavior event
 */
router.post('/track', async (req, res) => {
    try {
        const { userId, productId, eventType, category, metadata } = req.body;

        if (!userId || !productId || !eventType) {
            return res.status(400).json({
                success: false,
                error: 'userId, productId, and eventType are required',
            });
        }

        // Validate event type
        const validEventTypes = ['view', 'purchase', 'cart_add', 'wishlist', 'search'];
        if (!validEventTypes.includes(eventType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid eventType. Valid types: ${validEventTypes.join(', ')}`,
            });
        }

        await recommendationService.trackEvent(userId, productId, eventType, category, metadata || {});

        res.json({
            success: true,
            message: 'Event tracked successfully',
        });
    } catch (error) {
        console.error('Error tracking event:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

module.exports = router;
