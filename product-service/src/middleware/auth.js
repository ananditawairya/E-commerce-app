// backend/product-service/src/middleware/auth.js
// Ensure REST API communication only

const axios = require('axios');
const jwt = require('jsonwebtoken');

// Use REST API URL exclusively
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';

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
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Auth service unavailable');
    }
    if (error.response?.status === 401) {
      throw new Error('Invalid or expired token');
    }
    throw new Error('Authentication failed');
  }
};

const authenticate = async (context) => {
  const authHeader = context.req.headers.authorization;

  // Prefer end-user token when present. Internal gateway token only proves caller
  // is the gateway; it must not override user identity.
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new Error('Invalid authorization header');
    }

    const user = await verifyToken(token, context.correlationId);
    return user;
  }

  // Allow trusted internal service calls that do not need seller/buyer identity.
  const internalToken = context.req.headers['x-internal-gateway-token'];
  if (internalToken) {
    try {
      jwt.verify(internalToken, process.env.INTERNAL_JWT_SECRET || 'internal-secret');
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

module.exports = {
  authenticate,
  requireSeller,
};
