// ai-service/src/resolvers/recommendationResolvers.js

const recommendationService = require('../services/recommendationService');
const chatbotService = require('../services/chatbotService');

const resolvers = {
    Query: {
        getRecommendations: async (_, { userId, limit = 10 }, context) => {
            try {
                context.log?.info({ userId, limit }, 'Getting personalized recommendations');
                const recommendations = await recommendationService.getRecommendations(userId, limit);
                return recommendations;
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error getting recommendations');
                throw error;
            }
        },

        getSimilarProducts: async (_, { productId, limit = 10 }, context) => {
            try {
                context.log?.info({ productId, limit }, 'Getting similar products');
                const similar = await recommendationService.getSimilarProducts(productId, limit);
                return similar;
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error getting similar products');
                throw error;
            }
        },

        getTrendingProducts: async (_, { category, limit = 10 }, context) => {
            try {
                context.log?.info({ category, limit }, 'Getting trending products');
                const trending = await recommendationService.getTrendingProducts(category, limit);
                return trending;
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error getting trending products');
                throw error;
            }
        },

        getRecentlyViewed: async (_, { userId, limit = 10 }, context) => {
            try {
                context.log?.info({ userId, limit }, 'Getting recently viewed products');
                const recentlyViewed = await recommendationService.getRecentlyViewed(userId, limit);
                return recentlyViewed;
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error getting recently viewed');
                throw error;
            }
        },
    },

    Mutation: {
        trackEvent: async (_, { userId, productId, eventType, category, metadata }, context) => {
            try {
                context.log?.info({ userId, productId, eventType }, 'Tracking user event');

                // Parse metadata if provided as JSON string
                let parsedMetadata = {};
                if (metadata) {
                    try {
                        parsedMetadata = JSON.parse(metadata);
                    } catch {
                        parsedMetadata = { raw: metadata };
                    }
                }

                await recommendationService.trackEvent(userId, productId, eventType, category, parsedMetadata);

                return {
                    success: true,
                    message: 'Event tracked successfully',
                };
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error tracking event');
                return {
                    success: false,
                    message: error.message,
                };
            }
        },

        sendChatMessage: async (_, { userId, message, conversationId }, context) => {
            try {
                context.log?.info({ userId, messageLength: message.length }, 'Processing chat message');

                const response = await chatbotService.chat(userId, message, conversationId);

                context.log?.info({
                    conversationId: response.conversationId,
                    productsRecommended: response.products.length
                }, 'Chat response generated');

                return response;
            } catch (error) {
                context.log?.error({ error: error.message }, 'Error processing chat message');
                throw new Error(`Chat failed: ${error.message}`);
            }
        },
    },
};

module.exports = resolvers;

