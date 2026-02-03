// backend/ai-service/src/api/middleware/logger.js
// CHANGE: Centralized logging middleware

import { v4 as uuidv4 } from 'uuid';

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

  req.log.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
  }, 'Incoming request');

  next();
};

export default logger;