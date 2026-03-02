const User = require('../models/User');
const { generateTokens, verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');
const kafkaProducer = require('../kafka/kafkaProducer');
const cacheService = require('./cacheService');
const { appLogger } = require('../utils/logger');
const authOperations = require('./userService/authOperations');
const profileOperations = require('./userService/profileOperations');
const addressOperations = require('./userService/addressOperations');
const {
  invalidateUserProfileCache,
  getUserProfileCacheKey,
} = require('./userService/helpers');

const USER_PROFILE_CACHE_TTL_MS = Number.parseInt(
  process.env.AUTH_USER_PROFILE_CACHE_TTL_MS || '300000',
  10
);

/**
 * User domain service with authentication, profile, and address operations.
 */
class UserService {
  constructor() {
    this.deps = {
      User,
      appLogger,
      cacheService,
      generateTokens,
      kafkaProducer,
      userProfileCacheTtlMs: USER_PROFILE_CACHE_TTL_MS,
      verifyAccessToken,
      verifyRefreshToken,
    };
  }

  /**
   * Builds profile cache key for one user.
   * @param {string} userId User id.
   * @return {string} Cache key.
   */
  getUserProfileCacheKey(userId) {
    return getUserProfileCacheKey(userId);
  }

  /**
   * Invalidates one cached user profile.
   * @param {string} userId User id.
   * @return {Promise<void>} No return value.
   */
  async invalidateUserProfileCache(userId) {
    return invalidateUserProfileCache(this.deps, userId);
  }

  /**
   * Registers one user.
   * @param {{email: string, password: string, name: string, role: string}} input Registration payload.
   * @return {Promise<object>} Registration response.
   */
  async createUser(input) {
    return authOperations.createUser(this.deps, input);
  }

  /**
   * Authenticates one user.
   * @param {{email: string, password: string}} input Login payload.
   * @return {Promise<object>} Authentication response.
   */
  async authenticateUser(input) {
    return authOperations.authenticateUser(this.deps, input);
  }

  /**
   * Verifies access token.
   * @param {string} token Access token.
   * @return {Promise<object>} Verification payload.
   */
  async verifyUserToken(token) {
    return authOperations.verifyUserToken(this.deps, token);
  }

  /**
   * Returns user profile by id.
   * @param {string} userId User id.
   * @return {Promise<object>} Profile payload.
   */
  async getUserById(userId) {
    return profileOperations.getUserById(this.deps, userId);
  }

  /**
   * Updates mutable user profile fields.
   * @param {string} userId User id.
   * @param {object} profileData Profile payload.
   * @return {Promise<object>} Updated profile.
   */
  async updateUserProfile(userId, profileData) {
    return profileOperations.updateUserProfile(this.deps, userId, profileData);
  }

  /**
   * Exchanges refresh token for new token pair.
   * @param {string} refreshToken Refresh token.
   * @return {Promise<{accessToken: string, refreshToken: string}>} Token pair.
   */
  async refreshUserToken(refreshToken) {
    return authOperations.refreshUserToken(this.deps, refreshToken);
  }

  /**
   * Logs out user by removing refresh token.
   * @param {string} refreshToken Refresh token.
   * @return {Promise<boolean>} True when logout succeeds.
   */
  async logoutUser(refreshToken) {
    return authOperations.logoutUser(this.deps, refreshToken);
  }

  /**
   * Adds one user address.
   * @param {string} userId User id.
   * @param {object} addressData Address payload.
   * @return {Promise<object>} New address.
   */
  async addAddress(userId, addressData) {
    return addressOperations.addAddress(this.deps, userId, addressData);
  }

  /**
   * Updates one existing address.
   * @param {string} userId User id.
   * @param {string} addressId Address id.
   * @param {object} addressData Address payload.
   * @return {Promise<object>} Updated address.
   */
  async updateAddress(userId, addressId, addressData) {
    return addressOperations.updateAddress(this.deps, userId, addressId, addressData);
  }

  /**
   * Removes one address.
   * @param {string} userId User id.
   * @param {string} addressId Address id.
   * @return {Promise<boolean>} True when removed.
   */
  async removeAddress(userId, addressId) {
    return addressOperations.removeAddress(this.deps, userId, addressId);
  }

  /**
   * Marks one address as default.
   * @param {string} userId User id.
   * @param {string} addressId Address id.
   * @return {Promise<boolean>} True when updated.
   */
  async setDefaultAddress(userId, addressId) {
    return addressOperations.setDefaultAddress(this.deps, userId, addressId);
  }
}

module.exports = new UserService();
