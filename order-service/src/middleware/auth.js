// backend/order-service/src/middleware/auth.js

const axios = require('axios');

const verifyToken = async (token) => {
  try {
    const response = await axios.post(
      `${process.env.AUTH_SERVICE_URL}/graphql`,
      {
        query: `
          query VerifyToken($token: String!) {
            verifyToken(token: $token) {
              userId
              role
              valid
            }
          }
        `,
        variables: { token },
      }
    );

    const { data } = response.data;
    if (!data.verifyToken.valid) {
      throw new Error('Invalid token');
    }

    return data.verifyToken;
  } catch (error) {
    throw new Error('Authentication failed');
  }
};

const authenticate = async (context) => {
  const authHeader = context.req.headers.authorization;
  
  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const token = authHeader.replace('Bearer ', '');
  const user = await verifyToken(token);
  
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