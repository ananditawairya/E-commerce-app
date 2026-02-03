// ai-service/src/kafka/kafkaConsumer.js
// Listen for events from other services

const { Kafka, logLevel } = require('kafkajs');
const recommendationService = require('../services/recommendationService');

const kafka = new Kafka({
    clientId: 'ai-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    logLevel: process.env.KAFKA_LOG_LEVEL === 'DEBUG' ? logLevel.DEBUG : logLevel.ERROR,
    retry: {
        initialRetryTime: 1000,
        retries: 5,
    },
});

const consumer = kafka.consumer({ groupId: 'ai-service-group' });

let isConnected = false;

const start = async () => {
    try {
        await consumer.connect();
        isConnected = true;
        console.log('✅ AI Service Kafka consumer connected');

        // Subscribe to relevant topics
        await consumer.subscribe({
            topics: ['order.created', 'product.viewed', 'cart.updated'],
            fromBeginning: false,
        });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const data = JSON.parse(message.value.toString());
                    console.log(`📥 Received event from ${topic}:`, JSON.stringify(data).substring(0, 100));

                    switch (topic) {
                        case 'order.created':
                            await handleOrderCreated(data);
                            break;
                        case 'product.viewed':
                            await handleProductViewed(data);
                            break;
                        case 'cart.updated':
                            await handleCartUpdated(data);
                            break;
                    }
                } catch (error) {
                    console.error(`Error processing message from ${topic}:`, error);
                }
            },
        });

        console.log('✅ AI Service Kafka consumer running');
    } catch (error) {
        console.error('❌ Failed to start Kafka consumer:', error);
        throw error;
    }
};

/**
 * Handle order.created events
 * Track purchase behavior for all items in the order
 */
const handleOrderCreated = async (data) => {
    const { buyerId, items } = data;

    if (!buyerId || !items || !Array.isArray(items)) {
        console.warn('Invalid order.created event data');
        return;
    }

    for (const item of items) {
        try {
            await recommendationService.trackEvent(
                buyerId,
                item.productId,
                'purchase',
                item.category || null,
                {
                    orderId: data.orderId,
                    quantity: item.quantity,
                    price: item.price,
                    variantId: item.variantId,
                }
            );
        } catch (error) {
            console.error('Error tracking purchase event:', error);
        }
    }

    console.log(`✅ Tracked ${items.length} purchase events for order ${data.orderId}`);
};

/**
 * Handle product.viewed events
 */
const handleProductViewed = async (data) => {
    const { userId, productId, category } = data;

    if (!userId || !productId) {
        console.warn('Invalid product.viewed event data');
        return;
    }

    try {
        await recommendationService.trackEvent(
            userId,
            productId,
            'view',
            category || null,
            { source: data.source }
        );
        console.log(`✅ Tracked view event for product ${productId}`);
    } catch (error) {
        console.error('Error tracking view event:', error);
    }
};

/**
 * Handle cart.updated events
 */
const handleCartUpdated = async (data) => {
    const { userId, productId, action, category } = data;

    if (!userId || !productId) {
        console.warn('Invalid cart.updated event data');
        return;
    }

    // Only track add actions
    if (action !== 'add') {
        return;
    }

    try {
        await recommendationService.trackEvent(
            userId,
            productId,
            'cart_add',
            category || null,
            { variantId: data.variantId }
        );
        console.log(`✅ Tracked cart_add event for product ${productId}`);
    } catch (error) {
        console.error('Error tracking cart event:', error);
    }
};

const disconnect = async () => {
    if (isConnected) {
        await consumer.disconnect();
        isConnected = false;
        console.log('✅ AI Service Kafka consumer disconnected');
    }
};

module.exports = {
    start,
    disconnect,
};
