// backend/auth-service/src/resolvers/authResolvers.js
// CHANGE: Modified to call REST API instead of direct database access

const axios = require('axios');

const API_BASE_URL = process.env.AUTH_API_URL || 'http://localhost:4001/api/users';

const resolvers = {
  Query: {
    me: async (_, { token }, context) => {
      try {
        // CHANGE: Call REST API instead of direct database query
        const response = await axios.get(`${API_BASE_URL}/me`, {
          params: { token },
          headers: {
            'X-Correlation-ID': context.correlationId,
          },
        });
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || 'Authentication failed');
      }
    },

    verifyToken: async (_, { token }, context) => {
      try {
        // CHANGE: Call REST API instead of direct JWT verification
        const response = await axios.post(
          `${API_BASE_URL}/verify-token`,
          { token },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        return {
          userId: null,
          role: null,
          valid: false,
        };
      }
    },
  },

  Mutation: {
    register: async (_, { email, password, name, role }, context) => {
      try {
        // CHANGE: Call REST API instead of direct database operation
        const response = await axios.post(
          `${API_BASE_URL}/register`,
          { email, password, name, role },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    login: async (_, { email, password }, context) => {
      try {
        // CHANGE: Call REST API instead of direct database operation
        const response = await axios.post(
          `${API_BASE_URL}/login`,
          { email, password },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
      }
    },

    refreshToken: async (_, { refreshToken }, context) => {
      try {
        // CHANGE: Call REST API instead of direct database operation
        const response = await axios.post(
          `${API_BASE_URL}/refresh-token`,
          { refreshToken },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(error.response?.data?.message || 'Invalid refresh token');
      }
    },

    logout: async (_, { refreshToken }, context) => {
      try {
        // CHANGE: Call REST API instead of direct database operation
        const response = await axios.post(
          `${API_BASE_URL}/logout`,
          { refreshToken },
          {
            headers: {
              'X-Correlation-ID': context.correlationId,
            },
          }
        );
        return response.data.success;
      } catch (error) {
        return false;
      }
    },
  },
};

module.exports = resolvers;