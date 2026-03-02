const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a correlation id to every request/response.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next callback.
 * @return {void}
 */
function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
}

module.exports = {
  correlationMiddleware,
};
