// ai-service/src/middleware/auth.js
// Authentication middleware for AI REST routes

const axios = require('axios');
const jwt = require('jsonwebtoken');

const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

/**
 * Extracts bearer token from Authorization header.
 * @param {string|undefined} authHeader Authorization header value.
 * @return {string|null} Token value or null.
 */
function extractBearerToken(authHeader) {
  if (typeof authHeader !== 'string') {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

/**
 * Verifies end-user access token through auth-service.
 * @param {string} token Access token.
 * @param {string|undefined} correlationId Correlation id.
 * @return {Promise<object>} Verified user payload.
 */
async function verifyUserAccessToken(token, correlationId) {
  try {
    const response = await axios.post(
      `${AUTH_API_URL}/verify-token`,
      { token },
      {
        headers: {
          'X-Correlation-ID': correlationId,
        },
        timeout: 5000,
      }
    );

    if (!response.data?.valid) {
      throw new Error('Invalid token');
    }

    return response.data;
  } catch (error) {
    if (error.message === 'Invalid token') {
      throw new Error('Invalid or expired token');
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Auth service unavailable');
    }
    if (error.response?.status === 401) {
      throw new Error('Invalid or expired token');
    }
    throw new Error('Authentication failed');
  }
}

/**
 * Requires authenticated seller for admin operations.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @return {Promise<void>} Completion promise.
 */
async function requireSellerRestUser(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const user = await verifyUserAccessToken(token, req.correlationId);
    if (user.role !== 'seller') {
      res.status(403).json({ error: 'Seller access required' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.message === 'Auth service unavailable') {
      res.status(503).json({ error: 'Authentication service unavailable' });
      return;
    }

    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Requires internal service-to-service token.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @return {void}
 */
function requireInternalService(req, res, next) {
  const internalToken = req.headers['x-internal-gateway-token'];
  if (!internalToken) {
    res.status(401).json({ error: 'Internal gateway token required' });
    return;
  }

  try {
    req.internalCaller = jwt.verify(internalToken, INTERNAL_JWT_SECRET);
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid internal gateway token' });
  }
}

module.exports = {
  requireSellerRestUser,
  requireInternalService,
};
