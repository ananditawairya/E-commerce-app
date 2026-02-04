// backend/product-service/src/middleware/auth.js
// CHANGE: Enhanced authentication with better error handling and logging

const axios = require('axios');
const jwt = require('jsonwebtoken');

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

    // CHANGE: Validate response structure
    if (!response.data.userId || !response.data.role) {
      console.error('❌ Token verification returned incomplete data:', response.data);
      throw new Error('Invalid token response structure');
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
  // CHANGE: Enhanced logging for debugging
  console.log('🔐 authenticate() called');
  console.log('📋 Request headers:', {
    authorization: context.req?.headers?.authorization ? 'present' : 'missing',
    internalToken: context.req?.headers['x-internal-gateway-token'] ? 'present' : 'missing',
  });

  // CHANGE: Check for internal service-to-service authentication first
  const internalToken = context.req.headers['x-internal-gateway-token'];
  if (internalToken) {
    try {
      jwt.verify(internalToken, process.env.INTERNAL_JWT_SECRET || 'internal-secret');
      console.log('✅ Internal service token verified');
      
      // CHANGE: For internal calls, still require user authorization header
      const authHeader = context.req.headers.authorization;
      if (!authHeader) {
        console.error('❌ Internal call missing user authorization header');
        throw new Error('User authorization required');
      }
      
      // CHANGE: Verify user token even for internal calls
      const token = authHeader.replace('Bearer ', '');
      const user = await verifyToken(token, context.correlationId);
      
      console.log('✅ User authenticated via internal call:', {
        userId: user.userId,
        role: user.role,
      });
      
      return user;
    } catch (error) {
      console.error('❌ Internal token verification failed:', error.message);
      // CHANGE: Don't fall through to regular auth if internal token is invalid
      throw new Error('Invalid internal authentication');
    }
  }

  // CHANGE: Regular user authentication
  const authHeader = context.req.headers.authorization;

  if (!authHeader) {
    console.error('❌ No authorization header provided');
    throw new Error('No authorization header');
  }

  const token = authHeader.replace('Bearer ', '');
  
  // CHANGE: Validate token format
  if (!token || token.length < 20) {
    console.error('❌ Invalid token format');
    throw new Error('Invalid token format');
  }

  const user = await verifyToken(token, context.correlationId);
  
  console.log('✅ User authenticated:', {
    userId: user.userId,
    role: user.role,
  });

  return user;
};

const requireSeller = async (context) => {
  const user = await authenticate(context);

  // CHANGE: Validate user object structure
  if (!user || typeof user !== 'object') {
    console.error('❌ authenticate() returned invalid user:', user);
    throw new Error('Authentication failed: Invalid user object');
  }

  if (!user.userId) {
    console.error('❌ User object missing userId:', user);
    throw new Error('Authentication failed: Missing user ID');
  }

  if (user.role !== 'seller') {
    console.error('❌ User is not a seller:', { userId: user.userId, role: user.role });
    throw new Error('Seller access required');
  }

  console.log('✅ Seller access granted:', user.userId);
  return user;
};

module.exports = {
  authenticate,
  requireSeller,
};