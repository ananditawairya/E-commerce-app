// backend/order-service/src/middleware/auth.js
// Ensure REST API communication only

const axios = require('axios');

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

const authenticate = async (context) => {
  const authHeader = context.req.headers.authorization;
  
  if (!authHeader) {
    console.error('❌ No authorization header provided');
    throw new Error('No authorization header');
  }

  const token = authHeader.replace('Bearer ', '');

    // Add token format validation
  if (!token || token.length < 20) {
    console.error('❌ Invalid token format:', { tokenLength: token?.length });
    throw new Error('Invalid token format');
  }
  const user = await verifyToken(token, context.correlationId);
  
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

module.exports = {
  authenticate,
  requireBuyer,
  requireSeller,
};