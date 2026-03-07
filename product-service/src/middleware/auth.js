// backend/product-service/src/middleware/auth.js
// Ensure REST API communication only

const axios = require('axios');
const jwt = require('jsonwebtoken');

// Use REST API URL exclusively
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

/**
 * Extracts bearer token value from authorization header.
 * @param {string|undefined} authHeader Authorization header.
 * @return {string|null} Token value or null.
 */
const extractBearerToken = (authHeader) => {
  if (typeof authHeader !== 'string') {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
};

const verifyToken = async (token, correlationId) => {
  try {
    // Direct REST API call only
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

    if (!response.data.valid) {
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
};

const verifyInternalGatewayToken = (internalToken) =>
  jwt.verify(internalToken, INTERNAL_JWT_SECRET);

const verifyUserAccessToken = async (token, correlationId) => {
  const user = await verifyToken(token, correlationId);

  if (!user || !user.valid) {
    throw new Error('Invalid or expired token');
  }

  return user;
};

const authenticate = async (context) => {
  const authHeader = context.req.headers.authorization;

  // Prefer end-user token when present. Internal gateway token only proves caller
  // is the gateway; it must not override user identity.
  if (authHeader) {
    const token = extractBearerToken(authHeader);
    if (!token) {
      throw new Error('Invalid authorization header');
    }

    return verifyUserAccessToken(token, context.correlationId);
  }

  // Allow trusted internal service calls that do not need seller/buyer identity.
  const internalToken = context.req.headers['x-internal-gateway-token'];
  if (internalToken) {
    try {
      verifyInternalGatewayToken(internalToken);
      return {
        userId: 'gateway-internal',
        role: 'internal',
        email: 'gateway@ecom.internal',
        isInternal: true,
      };
    } catch (error) {
      console.error('Internal token verification failed:', error.message);
    }
  }

  throw new Error('No authorization header');
};

const requireSeller = async (context) => {
  const user = await authenticate(context);

  if (user.role !== 'seller') {
    throw new Error('Seller access required');
  }

  return user;
};

const authenticateRestUser = async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const user = await verifyUserAccessToken(token, req.correlationId);
    req.user = user;
    return next();
  } catch (error) {
    if (error.message === 'Auth service unavailable') {
      return res.status(503).json({ error: 'Authentication service unavailable' });
    }

    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireSellerRestUser = async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const user = await verifyUserAccessToken(token, req.correlationId);
    if (user.role !== 'seller') {
      return res.status(403).json({ error: 'Seller access required' });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.message === 'Auth service unavailable') {
      return res.status(503).json({ error: 'Authentication service unavailable' });
    }

    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireInternalService = (req, res, next) => {
  const internalToken = req.headers['x-internal-gateway-token'];
  if (!internalToken) {
    return res.status(401).json({ error: 'Internal gateway token required' });
  }

  try {
    const decoded = verifyInternalGatewayToken(internalToken);
    req.internalCaller = decoded;
    return next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid internal gateway token' });
  }
};

module.exports = {
  authenticate,
  requireSeller,
  authenticateRestUser,
  requireSellerRestUser,
  requireInternalService,
};
