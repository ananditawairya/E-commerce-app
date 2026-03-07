// backend/order-service/src/middleware/auth.js
// Ensure REST API communication only

const axios = require('axios');
const jwt = require('jsonwebtoken');

// Use REST API URL exclusively
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';
const INTERNAL_JWT_SECRET = process.env.INTERNAL_JWT_SECRET || 'internal-secret';

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
      console.error('❌ Token verification returned invalid:', {
        correlationId,
        responseData: response.data
      });
      throw new Error('Invalid token');
    }

     console.log('✅ Token verified successfully:', {
      userId: response.data.userId,
      role: response.data.role,
      correlationId
    });

    return response.data;
  } catch (error) {
    if (error.message === 'Invalid token') {
      throw new Error('Invalid or expired token');
    }
    console.error('❌ Token verification error:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      correlationId
    });
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
  
  if (!authHeader) {
    console.error('❌ No authorization header provided');
    throw new Error('No authorization header');
  }

  const token = extractBearerToken(authHeader);

  // Add token format validation
  if (!token || token.length < 20) {
    console.error('❌ Invalid token format:', { tokenLength: token?.length });
    throw new Error('Invalid token format');
  }
  const user = await verifyUserAccessToken(token, context.correlationId);
  
  return user;
};

const requireBuyer = async (context) => {
  const user = await authenticate(context);
  
  if (user.role !== 'buyer') {
    console.error('❌ Buyer access required but got role:', user.role);
    throw new Error('Buyer access required');
  }
  
  return user;
};

const requireSeller = async (context) => {
  const user = await authenticate(context);
  
  if (user.role !== 'seller') {
    console.error('❌ Seller access required but got role:', user.role);
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

const requireBuyerRestUser = async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const user = await verifyUserAccessToken(token, req.correlationId);
    if (user.role !== 'buyer') {
      return res.status(403).json({ error: 'Buyer access required' });
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
  authenticateRestUser,
  requireBuyer,
  requireBuyerRestUser,
  requireInternalService,
  requireSeller,
  requireSellerRestUser,
};
