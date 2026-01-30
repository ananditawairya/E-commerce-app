// backend/auth-service/src/api/middleware/logger.js
// CHANGE: Centralized logging middleware with correlation IDs

const { v4: uuidv4 } = require('uuid');

const logger = (req, res, next) => {
  // CHANGE: Generate or propagate correlation ID
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // CHANGE: Attach logger to request with correlation ID
  req.log = {
    info: (data, message) => {
      console.log(JSON.stringify({
        level: 'info',
        correlationId,
        timestamp: new Date().toISOString(),
        service: 'auth-service',
        message,
        ...data,
      }));
    },
    error: (data, message) => {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        timestamp: new Date().toISOString(),
        service: 'auth-service',
        message,
        ...data,
      }));
    },
  };

  // CHANGE: Log incoming request
  req.log.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
  }, 'Incoming request');

  next();
};

module.exports = logger;