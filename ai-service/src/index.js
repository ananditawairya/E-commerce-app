// ai-service/src/index.js
// AI Recommendations Service - Main Entry Point

require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const mongoose = require('mongoose');
const cors = require('cors');

const typeDefs = require('./schema/recommendationSchema');
const resolvers = require('./resolvers/recommendationResolvers');
const recommendationRoutes = require('./api/routes/recommendationRoutes');
const logger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');
const kafkaConsumer = require('./kafka/kafkaConsumer');
const cacheService = require('./services/cacheService');
const semanticSearchService = require('./services/semanticSearchService');

const app = express();
const isDevelopment = process.env.NODE_ENV !== 'production';

const CHAT_RATE_LIMIT_WINDOW_MS = Number.parseInt(
    process.env.AI_CHAT_RATE_LIMIT_WINDOW_MS || '60000',
    10
);
const CHAT_RATE_LIMIT_MAX = Number.parseInt(
    process.env.AI_CHAT_RATE_LIMIT_MAX || (isDevelopment ? '120' : '20'),
    10
);
const chatRequestBuckets = new Map();

const isChatMutationRequest = (req) => {
    const query = req.body?.query || '';
    const operationName = req.body?.operationName || '';
    return operationName === 'SendChatMessage' || query.includes('sendChatMessage');
};

const getClientRateLimitKey = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
};

const graphqlChatRateLimiter = (req, res, next) => {
    if (!isChatMutationRequest(req)) {
        return next();
    }

    const now = Date.now();
    const key = getClientRateLimitKey(req);
    const existingTimestamps = chatRequestBuckets.get(key) || [];
    const freshTimestamps = existingTimestamps.filter(
        (timestamp) => now - timestamp < CHAT_RATE_LIMIT_WINDOW_MS
    );

    if (freshTimestamps.length >= CHAT_RATE_LIMIT_MAX) {
        return res.status(429).json({
            error: 'Too many AI chat requests. Please wait and try again.',
        });
    }

    freshTimestamps.push(now);
    chatRequestBuckets.set(key, freshTimestamps);
    return next();
};

const rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();

    for (const [key, timestamps] of chatRequestBuckets.entries()) {
        const freshTimestamps = timestamps.filter(
            (timestamp) => now - timestamp < CHAT_RATE_LIMIT_WINDOW_MS
        );

        if (freshTimestamps.length === 0) {
            chatRequestBuckets.delete(key);
        } else {
            chatRequestBuckets.set(key, freshTimestamps);
        }
    }
}, CHAT_RATE_LIMIT_WINDOW_MS);

rateLimitCleanupInterval.unref();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(logger);

// REST API routes
app.use('/api/recommendations', recommendationRoutes);

// Error handling middleware
app.use(errorHandler);

// Health check endpoint
app.get('/health', (req, res) => {
    const semanticStatus = semanticSearchService.getPublicStatus();
    res.json({
        status: 'ok',
        service: 'ai-service',
        cacheMode: cacheService.getMode(),
        semantic: {
            enabled: semanticStatus.enabled,
            indexSize: semanticStatus.indexSize,
            updatedAt: semanticStatus.updatedAt,
            building: semanticStatus.building,
            source: semanticStatus.source,
        },
        timestamp: new Date().toISOString(),
    });
});

// Database connection
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ MongoDB connected - AI Service');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down gracefully...`);

    try {
        await cacheService.disconnect();
        await kafkaConsumer.disconnect();
        await mongoose.connection.close();
        console.log('✅ Connections closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
    try {
        await connectDB();
        await cacheService.connect();

        const server = new ApolloServer({
            typeDefs,
            resolvers,
            introspection: isDevelopment,
            playground: isDevelopment,
            context: ({ req }) => {
                const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'unknown';

                // Create logger if not present (for GraphQL requests)
                const log = req.log || {
                    info: (data, message) => {
                        console.log(JSON.stringify({
                            level: 'info',
                            correlationId,
                            timestamp: new Date().toISOString(),
                            service: 'ai-service',
                            message,
                            ...data,
                        }));
                    },
                    error: (data, message) => {
                        console.error(JSON.stringify({
                            level: 'error',
                            correlationId,
                            timestamp: new Date().toISOString(),
                            service: 'ai-service',
                            message,
                            ...data,
                        }));
                    },
                };

                return {
                    req,
                    correlationId,
                    log,
                };
            },
            formatError: (error) => {
                console.error('GraphQL Error:', error);
                return error;
            },
        });

        await server.start();
        app.use('/graphql', graphqlChatRateLimiter);
        server.applyMiddleware({ app, path: '/graphql' });

        const PORT = process.env.PORT || 4004;

        const httpServer = app.listen(PORT, () => {
            console.log(`🚀 AI Service running on http://localhost:${PORT}${server.graphqlPath}`);
            console.log(`📡 REST API available at http://localhost:${PORT}/api/recommendations`);
            if (isDevelopment) {
                console.log(`🔍 GraphQL Playground: http://localhost:${PORT}${server.graphqlPath}`);
            } else {
                console.log('🔒 GraphQL introspection/playground disabled in production');
            }

            // Start Kafka consumer AFTER server is listening (non-blocking)
            setImmediate(async () => {
                try {
                    console.log('📡 Starting Kafka consumer...');
                    await kafkaConsumer.start();
                    console.log('✅ Kafka consumer started successfully');
                } catch (error) {
                    console.warn('⚠️  Kafka consumer failed to start, continuing without event processing:', error.message);
                    console.warn('⚠️  AI service will continue to work, but automatic event tracking will not work');
                }
            });

            // Optional semantic warm-up (non-blocking)
            if (process.env.AI_SEMANTIC_INDEX_ON_STARTUP !== 'false') {
                setImmediate(async () => {
                    try {
                        if (!semanticSearchService.isEnabled()) {
                            console.log('ℹ️  Semantic warm-up skipped (disabled)');
                            return;
                        }

                        console.log('🧠 Scheduling semantic index warm-up...');
                        semanticSearchService.scheduleReindex('startup_warmup');
                    } catch (error) {
                        console.warn('⚠️  Semantic index warm-up skipped due to error:', error.message);
                    }
                });
            }
        });

        httpServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use`);
                process.exit(1);
            } else {
                console.error('❌ Server error:', error);
                process.exit(1);
            }
        });

    } catch (error) {
        console.error('❌ Failed to start AI Service:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

startServer();
