// ai-service/src/api/routes/recommendationRoutes.js

const express = require('express');
const router = express.Router();
const recommendationService = require('../../services/recommendationService');
const semanticSearchService = require('../../services/semanticSearchService');

const parseLimit = (value, fallback = 10, max = 50) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, max);
};

const parseMaybeNumber = (value) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(lowered)) return true;
        if (['false', '0', 'no', 'n'].includes(lowered)) return false;
    }

    return fallback;
};

/**
 * GET /api/recommendations/semantic/status
 * Get semantic index health and stats
 */
router.get('/semantic/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: semanticSearchService.getPublicStatus(),
        });
    } catch (error) {
        console.error('Error getting semantic status:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/recommendations/semantic/reindex
 * Force or schedule semantic index rebuild
 */
router.post('/semantic/reindex', async (req, res) => {
    try {
        const force = parseBoolean(req.body?.force, true);
        const wait = parseBoolean(req.body?.wait, true);
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim().slice(0, 80)
            : 'api_reindex';

        if (force && wait) {
            const status = await semanticSearchService.forceReindex(reason);
            return res.json({
                success: true,
                message: 'Semantic index rebuilt',
                data: status,
            });
        }

        semanticSearchService.scheduleReindex(reason);
        return res.status(202).json({
            success: true,
            message: 'Semantic reindex scheduled',
            data: semanticSearchService.getPublicStatus(),
        });
    } catch (error) {
        console.error('Error rebuilding semantic index:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/recommendations/semantic/invalidate
 * Invalidate semantic index and trigger background rebuild
 */
router.post('/semantic/invalidate', async (req, res) => {
    try {
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim().slice(0, 80)
            : 'api_invalidate';

        const status = await semanticSearchService.invalidateIndex(reason);

        return res.json({
            success: true,
            message: 'Semantic index invalidated',
            data: status,
        });
    } catch (error) {
        console.error('Error invalidating semantic index:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/recommendations/semantic/search
 * Debug semantic retrieval independent of chat
 */
router.get('/semantic/search', async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'q query parameter is required',
            });
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

        return res.json({
            success: true,
            data: result,
            status: semanticSearchService.getPublicStatus(),
        });
    } catch (error) {
        console.error('Error running semantic search:', error);
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
        const limit = parseLimit(req.query.limit, 10);

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
        const limit = parseLimit(req.query.limit, 10);

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
        const limit = parseLimit(req.query.limit, 10);

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

        const normalizedEventType = recommendationService.normalizeEventType(eventType);
        const validEventTypes = recommendationService.getValidEventTypes();

        if (!recommendationService.isValidEventType(normalizedEventType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid eventType. Valid types: ${validEventTypes.join(', ')}`,
            });
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
        console.error('Error tracking event:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/recommendations/:userId
 * Get personalized recommendations for a user
 */
router.get('/:userId', async (req, res) => {
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
        console.error('Error getting recommendations:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

module.exports = router;
