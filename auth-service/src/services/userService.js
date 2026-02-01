// backend/auth-service/src/services/userService.js
// CHANGE: Integrated Kafka event publishing

const User = require('../models/User');
const { generateTokens, verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');
// CHANGE: Import Kafka producer
const kafkaProducer = require('../kafka/kafkaProducer');

class UserService {
  async createUser({ email, password, name, role }) {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error('User already exists');
      error.code = 'USER_EXISTS';
      throw error;
    }

    const user = new User({ email, password, name, role });
    await user.save();

    const tokens = generateTokens({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    // CHANGE: Push object with token property instead of raw string
    user.refreshTokens.push({ token: tokens.refreshToken });
    await user.save();

    // CHANGE: Publish UserRegistered event to Kafka (async, non-blocking)
    setImmediate(async () => {
      try {
        await kafkaProducer.publishUserRegistered(
          {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
          },
          `user-reg-${Date.now()}`
        );
      } catch (error) {
        console.error('Failed to publish user registration event:', error);
      }
    });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async authenticateUser({ email, password }) {
    const user = await User.findOne({ email });
    if (!user) {
      const error = new Error('Invalid credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      const error = new Error('Invalid credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const tokens = generateTokens({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    // CHANGE: Push object with token property instead of raw string
    user.refreshTokens.push({ token: tokens.refreshToken });
    await user.save();

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async verifyUserToken(token) {
    try {
      const decoded = verifyAccessToken(token);
      return {
        userId: decoded.userId,
        role: decoded.role,
        valid: true,
      };
    } catch (error) {
      return { valid: false };
    }
  }

  async getUserById(userId) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  async refreshUserToken(refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);

      const user = await User.findById(decoded.userId);
      // CHANGE: Check token property in refreshTokens array
      if (!user || !user.refreshTokens.some(rt => rt.token === refreshToken)) {
        const error = new Error('Invalid refresh token');
        error.code = 'INVALID_REFRESH_TOKEN';
        throw error;
      }

      const tokens = generateTokens({
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      });

      // CHANGE: Filter by token property and push new object
      user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== refreshToken);
      user.refreshTokens.push({ token: tokens.refreshToken });
      await user.save();

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      const err = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }
  }

  async logoutUser(refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await User.findById(decoded.userId);

      if (user) {
        // CHANGE: Filter by token property
        user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== refreshToken);
        await user.save();
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new UserService();