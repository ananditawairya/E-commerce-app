// backend/auth-service/src/api/middleware/errorHandler.js
// CHANGE: Centralized error handling with standard HTTP status codes

const errorHandler = (err, req, res, next) => {
  // CHANGE: Log error with correlation ID
  req.log.error({
    error: err.message,
    stack: err.stack,
    code: err.code,
  }, 'Request error');

  // CHANGE: Map error codes to HTTP status codes
  const statusCodeMap = {
    'USER_EXISTS': 409,
    'INVALID_ROLE': 400,
    'INVALID_CREDENTIALS': 401,
    'USER_NOT_FOUND': 404,
    'INVALID_REFRESH_TOKEN': 401,
    'MISSING_TOKEN': 400,
    'INVALID_TOKEN': 401,
  };

  const statusCode = statusCodeMap[err.code] || 500;

  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    correlationId: req.correlationId,
  });
};

module.exports = errorHandler;