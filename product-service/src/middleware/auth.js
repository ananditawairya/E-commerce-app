// backend/product-service/src/middleware/auth.js
// CHANGE: Removed legacy GraphQL-based token verification, now uses REST API exclusively

const axios = require('axios');

// CHANGE: Use REST API URL from environment (no fallback to GraphQL)
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';

const verifyToken = async (token, correlationId) => {
  try {
    // CHANGE: Direct REST API call - no legacy GraphQL query construction
    const response = await axios.post(
      `${AUTH_API_URL}/verify-token`,
      { token },
      {
        headers: {
          'X-Correlation-ID': correlationId,
        },
        // CHANGE: Add timeout to prevent hanging requests
        timeout: 5000,
      }
    );

    if (!response.data.valid) {
      throw new Error('Invalid token');
    }

    return response.data;
  } catch (error) {
    // CHANGE: Improved error handling with specific error codes
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
  const user = await verifyToken(token, context.correlationId);
  
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
  requireSeller,
};