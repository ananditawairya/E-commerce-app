// backend/auth-service/src/services/userService.js
// CHANGE: New service layer to encapsulate all database operations

const User = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../utils/jwt');

class UserService {
  async createUser({ email, password, name, role }) {
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error('Email already registered');
      error.code = 'USER_EXISTS';
      throw error;
    }

    // Validate role
    if (!['buyer', 'seller'].includes(role)) {
      const error = new Error('Invalid role. Must be buyer or seller');
      error.code = 'INVALID_ROLE';
      throw error;
    }

    // Create new user
    const user = new User({ email, password, name, role });
    await user.save();

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token
    user.refreshTokens.push({ token: refreshToken });
    await user.save();

    return {
      user: user.toJSON(),
      accessToken,
      refreshToken,
    };
  }

  async authenticateUser({ email, password }) {
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      const error = new Error('Invalid credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      const error = new Error('Invalid credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token
    user.refreshTokens.push({ token: refreshToken });
    await user.save();

    return {
      user: user.toJSON(),
      accessToken,
      refreshToken,
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
      return {
        userId: null,
        role: null,
        valid: false,
      };
    }
  }

  async getUserById(userId) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    return user.toJSON();
  }

  async refreshUserToken(refreshToken) {
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Find user and check if refresh token exists
    const user = await User.findById(decoded.userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const tokenExists = user.refreshTokens.some(
      (rt) => rt.token === refreshToken
    );

    if (!tokenExists) {
      const error = new Error('Invalid refresh token');
      error.code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    // Generate new access token
    const accessToken = generateAccessToken(user._id, user.role);

    return { accessToken };
  }

  async logoutUser(refreshToken) {
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
  }
}

module.exports = new UserService();