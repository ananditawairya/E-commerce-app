// backend/shared/middleware/auth.js
// CHANGE: Shared authentication middleware for consistent token verification

const axios = require('axios');

// CHANGE: Use REST API URL exclusively
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';

const verifyToken = async (token, correlationId) => {
  try {
    // CHANGE: Direct REST API call only
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
  
  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const token = authHeader.replace('Bearer ', '');
  
  // CHANGE: Add token format validation
  if (!token || token.length < 20) {
    throw new Error('Invalid token format');
  }
  
  const user = await verifyToken(token, context.correlationId);
  
  return user;
};

const requireBuyer = async (context) => {
  const user = await authenticate(context);
  
  if (user.role !== 'buyer') {
    throw new Error('Buyer access required');
  }
  
  return user;
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
  requireBuyer,
  requireSeller,
};