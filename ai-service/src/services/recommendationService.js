// ai-service/src/services/recommendationService.js
// Core recommendation algorithms - designed for extensibility

const UserBehavior = require('../models/UserBehavior');
const ProductScore = require('../models/ProductScore');
const semanticSearchService = require('./semanticSearchService');

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

const SIMILAR_PRODUCTS_SIGNAL_WEIGHTS = Object.freeze({
    embedding: 0.55,
    category: 0.2,
    coPurchase: 0.15,
    popularity: 0.1,
});

const SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE = Number.parseFloat(
    process.env.AI_SIMILAR_MIN_EMBEDDING_SCORE || '0.34'
);

const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
};

const normalizeCategoryValue = (value) => {
    return String(value || '')
        .trim()
        .toLowerCase();
};

const tokenizeCategory = (value) => {
    return normalizeCategoryValue(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
};

const computeCategorySimilarity = (sourceCategory, candidateCategory) => {
    const source = normalizeCategoryValue(sourceCategory);
    const candidate = normalizeCategoryValue(candidateCategory);

    if (!source || !candidate) {
        return 0;
    }

    if (source === candidate) {
        return 1;
    }

    if (source.includes(candidate) || candidate.includes(source)) {
        return 0.75;
    }

    const sourceTokens = new Set(tokenizeCategory(source));
    const candidateTokens = tokenizeCategory(candidate);

    if (sourceTokens.size === 0 || candidateTokens.length === 0) {
        return 0;
    }

    const commonTokenCount = candidateTokens.reduce((count, token) => {
        return sourceTokens.has(token) ? count + 1 : count;
    }, 0);
    const overlapRatio = commonTokenCount / Math.max(sourceTokens.size, candidateTokens.length);

    return clamp(overlapRatio * 0.7, 0, 0.7);
};

const normalizeByMax = (value, maxValue) => {
    if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
        return 0;
    }

    return clamp(value / maxValue, 0, 1);
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

    normalizeLimit(limit, fallback = 10, max = 50) {
        const parsed = Number.parseInt(limit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }

        return Math.min(parsed, max);
    }

    async getMostRecentProductCategory(productId) {
        const latestBehavior = await UserBehavior.findOne({
            productId,
            category: { $nin: [null, ''] },
        })
            .sort({ createdAt: -1 })
            .select('category')
            .lean();

        if (latestBehavior?.category) {
            return latestBehavior.category;
        }

        const scoreDoc = await ProductScore.findOne({ productId })
            .select('category')
            .lean();

        return scoreDoc?.category || null;
    }

    async getCoPurchaseCandidates(productId, limit = 40) {
        const poolLimit = this.normalizeLimit(limit, 40, 200);

        const rows = await UserBehavior.aggregate([
            {
                $match: {
                    productId,
                    eventType: 'purchase',
                },
            },
            {
                $group: {
                    _id: '$userId',
                },
            },
            {
                $lookup: {
                    from: 'userbehaviors',
                    let: { buyerId: '$_id' },
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
                    buyerIds: { $addToSet: '$_id' },
                    category: { $first: '$otherPurchases.category' },
                },
            },
            {
                $project: {
                    category: 1,
                    buyerCount: { $size: '$buyerIds' },
                },
            },
            { $sort: { buyerCount: -1 } },
            { $limit: poolLimit },
        ]);

        return rows.map((row) => ({
            productId: row._id,
            category: row.category || null,
            buyerCount: Number(row.buyerCount) || 0,
        }));
    }

    /**
     * Hybrid similar products:
     * embedding (55%) + category similarity (20%) + co-purchase (15%) + popularity (10%).
     */
    async getHybridSimilarProducts(productId, limit = 10) {
        const normalizedLimit = this.normalizeLimit(limit, 10, 50);
        const candidatePoolLimit = Math.max(normalizedLimit * 6, 30);

        let semanticResult = {
            results: [],
            sourceCategory: null,
            semanticUsed: false,
            reason: 'not_attempted',
        };

        try {
            semanticResult = await semanticSearchService.getSimilarProductsByProductId(
                productId,
                {
                    limit: candidatePoolLimit,
                    minScore: SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE,
                    inStockOnly: false,
                }
            );
        } catch (error) {
            console.warn('Semantic similar-products lookup failed:', error.message);
        }

        const sourceCategory =
            semanticResult.sourceCategory || await this.getMostRecentProductCategory(productId);

        const semanticByProductId = new Map();
        for (const semanticEntry of semanticResult.results || []) {
            semanticByProductId.set(semanticEntry.productId, {
                score: Number(semanticEntry.score) || 0,
                category: semanticEntry.category || null,
            });
        }

        const coPurchaseCandidates = await this.getCoPurchaseCandidates(
            productId,
            candidatePoolLimit
        );
        const maxCoPurchaseCount = coPurchaseCandidates.reduce((maxCount, candidate) => {
            return Math.max(maxCount, Number(candidate.buyerCount) || 0);
        }, 0);

        const candidateByProductId = new Map();
        const addCandidate = (candidateProductId, category = null) => {
            if (!candidateProductId || candidateProductId === productId) {
                return;
            }

            const existing = candidateByProductId.get(candidateProductId) || {
                productId: candidateProductId,
                category: null,
                coPurchaseRaw: 0,
            };

            if (!existing.category && category) {
                existing.category = category;
            }

            candidateByProductId.set(candidateProductId, existing);
        };

        for (const [candidateProductId, semanticEntry] of semanticByProductId.entries()) {
            addCandidate(candidateProductId, semanticEntry.category);
        }

        for (const coPurchaseCandidate of coPurchaseCandidates) {
            addCandidate(coPurchaseCandidate.productId, coPurchaseCandidate.category);
            const existing = candidateByProductId.get(coPurchaseCandidate.productId);
            existing.coPurchaseRaw = Number(coPurchaseCandidate.buyerCount) || 0;
        }

        let categoryTrendingCandidates = [];
        if (sourceCategory) {
            categoryTrendingCandidates = await ProductScore.find({
                category: sourceCategory,
                productId: { $ne: productId },
            })
                .sort({ trendingScore: -1 })
                .limit(candidatePoolLimit)
                .select('productId category trendingScore')
                .lean();

            categoryTrendingCandidates.forEach((candidate) => {
                addCandidate(candidate.productId, candidate.category || sourceCategory);
            });
        }

        if (candidateByProductId.size === 0) {
            return [];
        }

        const productIds = Array.from(candidateByProductId.keys());
        const productScores = await ProductScore.find({
            productId: { $in: productIds },
        })
            .select('productId category trendingScore')
            .lean();

        const scoreByProductId = new Map();
        let maxTrendingScore = 0;
        productScores.forEach((scoreDoc) => {
            scoreByProductId.set(scoreDoc.productId, scoreDoc);
            maxTrendingScore = Math.max(maxTrendingScore, Number(scoreDoc.trendingScore) || 0);
        });

        const ranked = productIds.map((candidateProductId) => {
            const candidate = candidateByProductId.get(candidateProductId);
            const semanticSignal = semanticByProductId.get(candidateProductId);
            const scoreDoc = scoreByProductId.get(candidateProductId);

            const category =
                scoreDoc?.category ||
                candidate.category ||
                semanticSignal?.category ||
                null;

            const embeddingScore = clamp(
                Number(semanticSignal?.score) || 0,
                0,
                1
            );
            const categoryScore = computeCategorySimilarity(sourceCategory, category);
            const coPurchaseScore = normalizeByMax(candidate.coPurchaseRaw, maxCoPurchaseCount);
            const popularityScore = normalizeByMax(
                Number(scoreDoc?.trendingScore) || 0,
                maxTrendingScore
            );

            const finalScore =
                (embeddingScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.embedding) +
                (categoryScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.category) +
                (coPurchaseScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.coPurchase) +
                (popularityScore * SIMILAR_PRODUCTS_SIGNAL_WEIGHTS.popularity);

            let reason = 'Similar product';
            if (embeddingScore >= Math.max(categoryScore, coPurchaseScore, popularityScore)) {
                reason = 'Similar by embedding';
            } else if (categoryScore >= Math.max(coPurchaseScore, popularityScore)) {
                reason = category ? `Similar in ${category}` : 'Similar category';
            } else if (coPurchaseScore >= popularityScore) {
                reason = 'Frequently bought together';
            } else {
                reason = 'Popular similar product';
            }

            return {
                productId: candidateProductId,
                score: Number(finalScore.toFixed(4)),
                reason,
                category,
            };
        });

        return ranked
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, normalizedLimit);
    }

    async getSimilarProductsLegacy(productId, limit = 10, fallbackCategory = null) {
        const normalizedLimit = this.normalizeLimit(limit, 10, 50);
        const category = fallbackCategory || await this.getMostRecentProductCategory(productId);

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
            { $limit: Math.ceil(normalizedLimit / 2) },
        ]);

        const recommendations = coPurchased.map((row) => ({
            productId: row._id,
            score: row.score * 2,
            reason: 'Frequently bought together',
            category: row.category,
        }));

        if (recommendations.length < normalizedLimit && category) {
            const existingIds = recommendations.map((row) => row.productId);
            existingIds.push(productId);

            const sameCategoryProducts = await ProductScore.find({
                category,
                productId: { $nin: existingIds },
            })
                .sort({ trendingScore: -1 })
                .limit(normalizedLimit - recommendations.length);

            for (const product of sameCategoryProducts) {
                recommendations.push({
                    productId: product.productId,
                    score: product.trendingScore,
                    reason: `Similar product in ${category}`,
                    category: product.category,
                });
            }
        }

        return recommendations.slice(0, normalizedLimit);
    }

    /**
     * Get similar products using hybrid ranking with semantic and category signals.
     */
    async getSimilarProducts(productId, limit = 10) {
        const normalizedLimit = this.normalizeLimit(limit, 10, 50);

        try {
            const hybridRecommendations = await this.getHybridSimilarProducts(
                productId,
                normalizedLimit
            );

            if (hybridRecommendations.length > 0) {
                return hybridRecommendations;
            }

            const categoryFallback = await this.getMostRecentProductCategory(productId);
            return await this.getSimilarProductsLegacy(
                productId,
                normalizedLimit,
                categoryFallback
            );
        } catch (error) {
            console.error('Error getting similar products:', error);
            try {
                const categoryFallback = await this.getMostRecentProductCategory(productId);
                return await this.getSimilarProductsLegacy(
                    productId,
                    normalizedLimit,
                    categoryFallback
                );
            } catch (fallbackError) {
                console.error('Error getting fallback similar products:', fallbackError);
                return [];
            }
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
