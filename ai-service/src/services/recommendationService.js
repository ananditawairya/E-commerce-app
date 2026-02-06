// ai-service/src/services/recommendationService.js
// Core recommendation algorithms - designed for extensibility

const UserBehavior = require('../models/UserBehavior');
const ProductScore = require('../models/ProductScore');

const VALID_EVENT_TYPES = new Set([
    'view',
    'purchase',
    'cart_add',
    'cart_remove',
    'wishlist',
    'search',
]);

const EVENT_TYPE_ALIASES = {
    add_to_cart: 'cart_add',
    remove_from_cart: 'cart_remove',
    cartadded: 'cart_add',
    cartremoved: 'cart_remove',
};

class RecommendationService {
    normalizeEventType(eventType) {
        if (typeof eventType !== 'string') {
            return null;
        }

        const normalized = eventType.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        return EVENT_TYPE_ALIASES[normalized] || normalized;
    }

    isValidEventType(eventType) {
        return VALID_EVENT_TYPES.has(eventType);
    }

    getValidEventTypes() {
        return Array.from(VALID_EVENT_TYPES);
    }

    /**
     * Track a user behavior event
     */
    async trackEvent(userId, productId, eventType, category = null, metadata = {}) {
        try {
            const normalizedEventType = this.normalizeEventType(eventType);

            if (!this.isValidEventType(normalizedEventType)) {
                const error = new Error(
                    `Invalid eventType "${eventType}". Valid types: ${this.getValidEventTypes().join(', ')}`
                );
                error.code = 'INVALID_EVENT_TYPE';
                throw error;
            }

            // Save behavior event
            const behavior = new UserBehavior({
                userId,
                productId,
                eventType: normalizedEventType,
                category,
                metadata,
            });
            await behavior.save();

            // Update product scores
            await this.updateProductScore(productId, normalizedEventType, category);

            return true;
        } catch (error) {
            console.error('Error tracking event:', error);
            throw error;
        }
    }

    /**
     * Update product popularity scores
     */
    async updateProductScore(productId, eventType, category = null) {
        const updateFields = {
            lastInteraction: new Date(),
        };

        const incrementFields = {};

        switch (eventType) {
            case 'view':
                incrementFields.viewCount = 1;
                break;
            case 'purchase':
                incrementFields.purchaseCount = 1;
                break;
            case 'cart_add':
                incrementFields.cartAddCount = 1;
                break;
        }

        // Update or create product score document
        await ProductScore.findOneAndUpdate(
            { productId },
            {
                $set: { ...updateFields, category },
                $inc: incrementFields,
            },
            { upsert: true, new: true }
        );

        // Recalculate trending score
        await this.recalculateTrendingScore(productId);
    }

    /**
     * Recalculate trending score based on weighted interactions
     * Formula: views * 1 + cart_adds * 3 + purchases * 5
     * Decays over time (more recent = higher score)
     */
    async recalculateTrendingScore(productId) {
        const score = await ProductScore.findOne({ productId });
        if (!score) return;

        // Weighted score calculation
        const trendingScore =
            (score.viewCount * 1) +
            (score.cartAddCount * 3) +
            (score.purchaseCount * 5);

        await ProductScore.updateOne(
            { productId },
            { $set: { trendingScore } }
        );
    }

    /**
     * Get personalized recommendations for a user
     * Combines multiple strategies
     */
    async getRecommendations(userId, limit = 10) {
        const recommendations = [];

        try {
            // Strategy 1: Based on user's purchase history (collaborative filtering)
            const collaborativeRecs = await this.getCollaborativeRecommendations(userId, Math.ceil(limit / 2));

            // Strategy 2: Based on user's viewed categories (content-based)
            const contentRecs = await this.getContentBasedRecommendations(userId, Math.ceil(limit / 2));

            // Merge and deduplicate
            const seen = new Set();

            for (const rec of [...collaborativeRecs, ...contentRecs]) {
                if (!seen.has(rec.productId)) {
                    seen.add(rec.productId);
                    recommendations.push(rec);
                }
            }

            return recommendations.slice(0, limit);
        } catch (error) {
            console.error('Error getting recommendations:', error);
            return [];
        }
    }

    /**
     * Collaborative filtering: "Users who bought X also bought Y"
     */
    async getCollaborativeRecommendations(userId, limit = 5) {
        // Get products the user has purchased
        const userPurchases = await UserBehavior.find({
            userId,
            eventType: 'purchase',
        }).distinct('productId');

        if (userPurchases.length === 0) {
            return [];
        }

        // Find other users who purchased the same products
        const similarUsers = await UserBehavior.find({
            productId: { $in: userPurchases },
            eventType: 'purchase',
            userId: { $ne: userId },
        }).distinct('userId');

        if (similarUsers.length === 0) {
            return [];
        }

        // Get products purchased by similar users that the current user hasn't purchased
        const recommendations = await UserBehavior.aggregate([
            {
                $match: {
                    userId: { $in: similarUsers },
                    eventType: 'purchase',
                    productId: { $nin: userPurchases },
                },
            },
            {
                $group: {
                    _id: '$productId',
                    score: { $sum: 1 },
                    category: { $first: '$category' },
                },
            },
            { $sort: { score: -1 } },
            { $limit: limit },
        ]);

        return recommendations.map(r => ({
            productId: r._id,
            score: r.score,
            reason: 'Customers who bought similar products also bought this',
            category: r.category,
        }));
    }

    /**
     * Content-based: Recommend products from categories the user has shown interest in
     */
    async getContentBasedRecommendations(userId, limit = 5) {
        // Get user's preferred categories based on views and purchases
        const userCategories = await UserBehavior.aggregate([
            {
                $match: {
                    userId,
                    eventType: { $in: ['view', 'purchase', 'cart_add'] },
                    category: { $ne: null },
                },
            },
            {
                $group: {
                    _id: '$category',
                    score: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$eventType', 'purchase'] }, then: 5 },
                                    { case: { $eq: ['$eventType', 'cart_add'] }, then: 3 },
                                    { case: { $eq: ['$eventType', 'view'] }, then: 1 },
                                ],
                                default: 1,
                            },
                        },
                    },
                },
            },
            { $sort: { score: -1 } },
            { $limit: 3 },
        ]);

        if (userCategories.length === 0) {
            return [];
        }

        const categories = userCategories.map(c => c._id);

        // Get user's already interacted products to exclude
        const userProducts = await UserBehavior.find({ userId }).distinct('productId');

        // Get top trending products from preferred categories
        const recommendations = await ProductScore.find({
            category: { $in: categories },
            productId: { $nin: userProducts },
        })
            .sort({ trendingScore: -1 })
            .limit(limit);

        return recommendations.map(r => ({
            productId: r.productId,
            score: r.trendingScore,
            reason: `Popular in ${r.category}`,
            category: r.category,
        }));
    }

    /**
     * Get similar products based on category and co-purchase patterns
     */
    async getSimilarProducts(productId, limit = 10) {
        try {
            // Get the product's category
            const productBehavior = await UserBehavior.findOne({ productId });
            const category = productBehavior?.category;

            // Find products frequently purchased together
            const coPurchased = await UserBehavior.aggregate([
                {
                    $match: {
                        productId,
                        eventType: 'purchase',
                    },
                },
                {
                    $lookup: {
                        from: 'userbehaviors',
                        let: { buyerId: '$userId' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$userId', '$$buyerId'] },
                                            { $eq: ['$eventType', 'purchase'] },
                                            { $ne: ['$productId', productId] },
                                        ],
                                    },
                                },
                            },
                        ],
                        as: 'otherPurchases',
                    },
                },
                { $unwind: '$otherPurchases' },
                {
                    $group: {
                        _id: '$otherPurchases.productId',
                        score: { $sum: 1 },
                        category: { $first: '$otherPurchases.category' },
                    },
                },
                { $sort: { score: -1 } },
                { $limit: Math.ceil(limit / 2) },
            ]);

            const recommendations = coPurchased.map(r => ({
                productId: r._id,
                score: r.score * 2, // Higher weight for co-purchase
                reason: 'Frequently bought together',
                category: r.category,
            }));

            // Fill remaining with same-category products
            if (recommendations.length < limit && category) {
                const existingIds = recommendations.map(r => r.productId);
                existingIds.push(productId);

                const sameCategoryProducts = await ProductScore.find({
                    category,
                    productId: { $nin: existingIds },
                })
                    .sort({ trendingScore: -1 })
                    .limit(limit - recommendations.length);

                for (const p of sameCategoryProducts) {
                    recommendations.push({
                        productId: p.productId,
                        score: p.trendingScore,
                        reason: `Similar product in ${category}`,
                        category: p.category,
                    });
                }
            }

            return recommendations.slice(0, limit);
        } catch (error) {
            console.error('Error getting similar products:', error);
            return [];
        }
    }

    /**
     * Get trending products globally or by category
     */
    async getTrendingProducts(category = null, limit = 10) {
        try {
            const query = category ? { category } : {};

            const trending = await ProductScore.find(query)
                .sort({ trendingScore: -1 })
                .limit(limit);

            return trending.map(p => ({
                productId: p.productId,
                score: p.trendingScore,
                reason: category ? `Trending in ${category}` : 'Trending now',
                category: p.category,
            }));
        } catch (error) {
            console.error('Error getting trending products:', error);
            return [];
        }
    }

    /**
     * Get user's recently viewed products
     */
    async getRecentlyViewed(userId, limit = 10) {
        try {
            const recentViews = await UserBehavior.find({
                userId,
                eventType: 'view',
            })
                .sort({ createdAt: -1 })
                .limit(limit);

            // Deduplicate by productId, keeping most recent
            const seen = new Set();
            const unique = [];

            for (const view of recentViews) {
                if (!seen.has(view.productId)) {
                    seen.add(view.productId);
                    unique.push({
                        productId: view.productId,
                        score: 1,
                        reason: 'Recently viewed',
                        category: view.category,
                    });
                }
            }

            return unique;
        } catch (error) {
            console.error('Error getting recently viewed:', error);
            return [];
        }
    }
}

module.exports = new RecommendationService();
