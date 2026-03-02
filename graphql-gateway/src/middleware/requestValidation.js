/**
 * Validates incoming GraphQL request payload.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next callback.
 * @return {void}
 */
function validateGraphQLRequest(req, res, next) {
  const { query } = req.body;

  if (!query) {
    res.status(400).json({ error: 'GraphQL query is required' });
    return;
  }

  if (typeof query !== 'string') {
    res.status(400).json({ error: 'Query must be a string' });
    return;
  }

  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (!isDevelopment) {
    const dangerousPatterns = [
      /__schema/,
      /__type/,
      /introspection/i,
    ];

    if (dangerousPatterns.some((pattern) => pattern.test(query))) {
      res.status(403).json({ error: 'Introspection queries are not allowed in production' });
      return;
    }
  }

  next();
}

module.exports = {
  validateGraphQLRequest,
};
