// backend/product-service/src/api/middleware/errorHandler.js
// CHANGE: Centralized error handling for product service

const errorHandler = (err, req, res, next) => {
  req.log.error({
    error: err.message,
    stack: err.stack,
    code: err.code,
  }, 'Request error');

  const statusCodeMap = {
    'PRODUCT_NOT_FOUND': 404,
    'VARIANT_NOT_FOUND': 404,
    'MISSING_FIELDS': 400,
    'INVALID_PRICE': 400,
    'MISSING_VARIANTS': 400,
    'INVALID_STOCK': 400,
    'INSUFFICIENT_STOCK': 409,
    'STOCK_DEDUCTION_FAILED': 409,
  };

  const statusCode = statusCodeMap[err.code] || 500;

  const response = {
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    correlationId: req.correlationId,
  };

  // CHANGE: Include additional error details for specific codes
  if (err.code === 'INSUFFICIENT_STOCK') {
    response.available = err.available;
    response.requested = err.requested;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;