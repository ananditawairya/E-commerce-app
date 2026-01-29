// backend/auth-service/src/resolvers/authResolvers.js

const User = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../utils/jwt');

const resolvers = {
  Query: {
    me: async (_, { token }) => {
      try {
        const decoded = verifyAccessToken(token);
        const user = await User.findById(decoded.userId);
        if (!user) throw new Error('User not found');
        return user;
      } catch (error) {
        throw new Error('Authentication failed');
      }
    },

    verifyToken: async (_, { token }) => {
      try {
        const decoded = verifyAccessToken(token);
        return {
          userId: decoded.userId,
          role: decoded.role,
          valid: true,
        };
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
    register: async (_, { email, password, name, role }) => {
      try {
        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          throw new Error('Email already registered');
        }

        // Validate role
        if (!['buyer', 'seller'].includes(role)) {
          throw new Error('Invalid role. Must be buyer or seller');
        }

        // Create new user
        const user = new User({
          email,
          password,
          name,
          role,
        });

        await user.save();

        // Generate tokens
        const accessToken = generateAccessToken(user._id, user.role);
        const refreshToken = generateRefreshToken(user._id);

        // Save refresh token
        user.refreshTokens.push({ token: refreshToken });
        await user.save();

        return {
          user,
          accessToken,
          refreshToken,
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },

    login: async (_, { email, password }) => {
      try {
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
          throw new Error('Invalid credentials');
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
          throw new Error('Invalid credentials');
        }

        // Generate tokens
        const accessToken = generateAccessToken(user._id, user.role);
        const refreshToken = generateRefreshToken(user._id);

        // Save refresh token
        user.refreshTokens.push({ token: refreshToken });
        await user.save();

        return {
          user,
          accessToken,
          refreshToken,
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },

    refreshToken: async (_, { refreshToken }) => {
      try {
        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Find user and check if refresh token exists
        const user = await User.findById(decoded.userId);
        if (!user) {
          throw new Error('User not found');
        }

        const tokenExists = user.refreshTokens.some(
          (rt) => rt.token === refreshToken
        );

        if (!tokenExists) {
          throw new Error('Invalid refresh token');
        }

        // Generate new access token
        const accessToken = generateAccessToken(user._id, user.role);

        return { accessToken };
      } catch (error) {
        throw new Error('Invalid refresh token');
      }
    },

    logout: async (_, { refreshToken }) => {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        const user = await User.findById(decoded.userId);

        if (user) {
          user.refreshTokens = user.refreshTokens.filter(
            (rt) => rt.token !== refreshToken
          );
          await user.save();
        }

        return true;
      } catch (error) {
        return false;
      }
    },
  },
};

module.exports = resolvers;