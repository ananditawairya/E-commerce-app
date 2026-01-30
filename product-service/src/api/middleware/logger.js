// backend/product-service/src/api/middleware/logger.js
// CHANGE: Centralized logging middleware

const { v4: uuidv4 } = require('uuid');

const logger = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  req.log = {
    info: (data, message) => {
      console.log(JSON.stringify({
        level: 'info',
        correlationId,
        timestamp: new Date().toISOString(),
        service: 'product-service',
        message,
        ...data,
      }));
    },
    error: (data, message) => {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        timestamp: new Date().toISOString(),
        service: 'product-service',
        message,
        ...data,
      }));
    },
  };

  req.log.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
  }, 'Incoming request');

  next();
};

module.exports = logger;