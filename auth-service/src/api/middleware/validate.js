/**
 * Validation middleware factory
 * @param {Object} schema - Joi validation schema
 * @param {string} property - Request property to validate ('body', 'params', 'query')
 * @returns {Function} Express middleware function
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true, // Remove unknown keys from the validated data
      convert: true // Attempt to cast values to the required types
    });

    if (error) {
      // Extract validation error details
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      // CHANGE: Use req.log.error instead of logger.warn (logger middleware only provides info/error methods)
      if (req.log) {
        req.log.error({
          property,
          errors,
          requestId: req.id
        }, 'Validation failed');
      }

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Replace request property with validated and sanitized value
    req[property] = value;
    next();
  };
};

module.exports = validate;