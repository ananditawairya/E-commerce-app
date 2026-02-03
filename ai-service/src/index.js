// backend/ai-service/src/index.js
// CHANGE: Add REST API layer and Kafka consumer

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import embeddingService from './services/embeddingService.js';
import searchRoutes from './api/routes/searchRoutes.js';
import logger from './api/middleware/logger.js';
import errorHandler from './api/middleware/errorHandler.js';
import kafkaConsumer from './kafka/kafkaConsumer.js';

dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.GATEWAY_URL || 'http://localhost:4000',
  credentials: true,
}));
app.use(express.json());
app.use(logger);

// CHANGE: REST API routes
app.use('/api/search', searchRoutes);

// CHANGE: Error handling middleware
app.use(errorHandler);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-service',
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 4004;

// CHANGE: Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    await kafkaConsumer.disconnect();
    await embeddingService.disconnect();
    console.log('✅ Connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const startServer = async () => {
  try {
    console.log('🤖 Loading AI model...');
    await embeddingService.initialize();
    console.log('✅ AI model loaded successfully');

    const httpServer = app.listen(PORT, 'localhost', () => {
      console.log(`🚀 AI Service running on http://localhost:${PORT}`);
      console.log(`📡 REST API available at http://localhost:${PORT}/api/search`);
      
      // CHANGE: Start Kafka consumer AFTER server is listening
      setImmediate(async () => {
        try {
          console.log('📡 Starting Kafka consumer for product indexing...');
          await kafkaConsumer.start();
          console.log('✅ Kafka consumer started - listening for ProductCreated/Updated events');
        } catch (error) {
          console.error('❌ Kafka consumer failed to start:', error.message);
          console.error('⚠️  Real-time indexing will not work without Kafka consumer!');
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
    process.exit(1);
  }
};

startServer();