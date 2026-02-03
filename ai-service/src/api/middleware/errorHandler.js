// backend/ai-service/src/api/middleware/errorHandler.js
// CHANGE: Centralized error handling

const errorHandler = (err, req, res, next) => {
  if (req.log && typeof req.log.error === 'function') {
    req.log.error({
      error: err.message,
      stack: err.stack,
      code: err.code,
    }, 'Request error');
  } else {
    console.error(JSON.stringify({
      level: 'error',
      correlationId: req.correlationId || 'unknown',
      timestamp: new Date().toISOString(),
      service: 'ai-service',
      message: 'Request error',
      error: err.message,
      stack: err.stack,
      code: err.code,
    }));
  }

  const statusCodeMap = {
    'MISSING_QUERY': 400,
    'INDEXING_FAILED': 500,
    'PRODUCT_NOT_FOUND': 404,
  };

  const statusCode = statusCodeMap[err.code] || 500;

  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    correlationId: req.correlationId || 'unknown',
  });
};

export default errorHandler;