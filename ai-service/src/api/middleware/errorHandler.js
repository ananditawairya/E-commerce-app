// ai-service/src/api/middleware/errorHandler.js
// Global error handling middleware

const errorHandler = (err, req, res, next) => {
    const correlationId = req.correlationId || 'unknown';

    console.error(JSON.stringify({
        level: 'error',
        correlationId,
        timestamp: new Date().toISOString(),
        service: 'ai-service',
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    }));

    // Don't leak error details in production
    const isProduction = process.env.NODE_ENV === 'production';

    res.status(err.status || 500).json({
        success: false,
        error: isProduction ? 'Internal Server Error' : err.message,
        correlationId,
    });
};

module.exports = errorHandler;
