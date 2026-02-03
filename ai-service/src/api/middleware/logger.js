// ai-service/src/api/middleware/logger.js
// Request logging middleware

const { v4: uuidv4 } = require('uuid');

const logger = (req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    const start = Date.now();

    // Create logger helper
    req.log = {
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
        warn: (data, message) => {
            console.warn(JSON.stringify({
                level: 'warn',
                correlationId,
                timestamp: new Date().toISOString(),
                service: 'ai-service',
                message,
                ...data,
            }));
        },
    };

    // Log request on finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        req.log.info({
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
        }, 'Request completed');
    });

    next();
};

module.exports = logger;
