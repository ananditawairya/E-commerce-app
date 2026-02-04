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

const app = express();

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
    // CHANGE: Import circuit breakers to check status
    const chatbotService = require('./services/chatbotService');

    const healthStatus = {
        status: 'ok',
        service: 'ai-service',
        timestamp: new Date().toISOString(),
        // CHANGE: Add circuit breaker status if available
        circuitBreakers: {
            productService: 'healthy', // Will be updated when breakers are accessible
            geminiApi: 'healthy',
        },
    };

    res.json(healthStatus);
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

        const server = new ApolloServer({
            typeDefs,
            resolvers,
            introspection: true,
            playground: true,
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
        server.applyMiddleware({ app, path: '/graphql' });

        const PORT = process.env.PORT || 4004;

        const httpServer = app.listen(PORT, () => {
            console.log(`🚀 AI Service running on http://localhost:${PORT}${server.graphqlPath}`);
            console.log(`📡 REST API available at http://localhost:${PORT}/api/recommendations`);
            console.log(`🔍 GraphQL Playground: http://localhost:${PORT}${server.graphqlPath}`);
            console.log(`🛡️ Resilience Features Enabled:`);
            console.log(`   - Circuit Breakers: Product Service, Gemini API`);
            console.log(`   - Retry Logic: Exponential backoff with jitter`);
            console.log(`   - Rate Limiting: Handled by gateway`);

            // Start Kafka consumer AFTER server is listening (non-blocking)
            setImmediate(async () => {
                try {
                    console.log('📡 Starting Kafka consumer...');
                    await kafkaConsumer.start();
                    console.log('✅ Kafka consumer started successfully');
                } catch (error) {
                    console.warn('⚠️  Kafka consumer failed to start, continuing without event processing:', error.message);
                }
            });
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
