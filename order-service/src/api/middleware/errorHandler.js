// backend/order-service/src/api/middleware/errorHandler.js
// CHANGE: Centralized error handling for order service

const errorHandler = (err, req, res, next) => {
  req.log.error({
    error: err.message,
    stack: err.stack,
    code: err.code,
  }, 'Request error');

  const statusCodeMap = {
    'CART_NOT_FOUND': 404,
    'ITEM_NOT_FOUND': 404,
    'ORDER_NOT_FOUND': 404,
    'UNAUTHORIZED': 403,
    'CART_EMPTY': 400,
    'INSUFFICIENT_STOCK': 409,
  };

  const statusCode = statusCodeMap[err.code] || 500;

  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    correlationId: req.correlationId,
  });
};

module.exports = errorHandler;