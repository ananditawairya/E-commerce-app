// backend/auth-service/src/services/userService.js

const User = require('../models/User');
const { generateTokens, verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');
const kafkaProducer = require('../kafka/kafkaProducer');
const cacheService = require('./cacheService');
const { appLogger } = require('../utils/logger');

const USER_PROFILE_CACHE_TTL_MS = Number.parseInt(
  process.env.AUTH_USER_PROFILE_CACHE_TTL_MS || '300000',
  10
);

class UserService {
  getUserProfileCacheKey(userId) {
    return `auth:user:profile:${userId}`;
  }

  buildAddress(address) {
    return {
      id: (address._id || address.id).toString(),
      street: address.street,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      country: address.country,
      isDefault: Boolean(address.isDefault),
    };
  }

  buildUserProfile(user) {
    const preferences = user.preferences?.toObject ? user.preferences.toObject() : (user.preferences || {});

    return {
      id: (user._id || user.id).toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      phoneNumber: user.phoneNumber || null,
      avatarUrl: user.avatarUrl || null,
      bio: user.bio || '',
      dateOfBirth: user.dateOfBirth || null,
      emailVerified: Boolean(user.emailVerified),
      preferences: {
        language: preferences.language || 'en-US',
        currency: preferences.currency || 'USD',
        timezone: preferences.timezone || 'UTC',
        marketingEmails: Boolean(preferences.marketingEmails),
        orderUpdates: preferences.orderUpdates !== false,
      },
      addresses: (user.addresses || []).map((address) => this.buildAddress(address)),
      lastLoginAt: user.lastLoginAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async cacheUserProfile(profile) {
    if (!profile?.id) {
      return;
    }

    await cacheService.setJson(
      this.getUserProfileCacheKey(profile.id),
      profile,
      USER_PROFILE_CACHE_TTL_MS
    );
  }

  async invalidateUserProfileCache(userId) {
    if (!userId) {
      return;
    }

    await cacheService.delete(this.getUserProfileCacheKey(userId));
  }

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

    user.refreshTokens.push({ token: tokens.refreshToken });
    await user.save();

    await this.cacheUserProfile(this.buildUserProfile(user));

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
        appLogger.error({ error: error.message }, 'Failed to publish user registration event');
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

    user.refreshTokens.push({ token: tokens.refreshToken });
    user.lastLoginAt = new Date();
    await user.save();

    await this.cacheUserProfile(this.buildUserProfile(user));

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
    const key = this.getUserProfileCacheKey(userId);

    const { value } = await cacheService.withJsonCache(
      key,
      USER_PROFILE_CACHE_TTL_MS,
      async () => {
        const user = await User.findById(userId).lean();
        if (!user) {
          const error = new Error('User not found');
          error.code = 'USER_NOT_FOUND';
          throw error;
        }

        return this.buildUserProfile(user);
      }
    );

    return value;
  }

  async updateUserProfile(userId, profileData) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const updatableFields = ['name', 'phoneNumber', 'avatarUrl', 'bio'];
    updatableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(profileData, field)) {
        user[field] = profileData[field];
      }
    });

    if (Object.prototype.hasOwnProperty.call(profileData, 'dateOfBirth')) {
      user.dateOfBirth = profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null;
    }

    if (profileData.preferences) {
      const currentPreferences = user.preferences?.toObject ? user.preferences.toObject() : (user.preferences || {});
      user.preferences = {
        ...currentPreferences,
        ...profileData.preferences,
      };
    }

    await user.save();

    const profile = this.buildUserProfile(user);
    await this.cacheUserProfile(profile);

    return profile;
  }

  async refreshUserToken(refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await User.findById(decoded.userId);

      if (!user || !user.refreshTokens.some((rt) => rt.token === refreshToken)) {
        const error = new Error('Invalid refresh token');
        error.code = 'INVALID_REFRESH_TOKEN';
        throw error;
      }

      const tokens = generateTokens({
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      });

      user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== refreshToken);
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
        user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== refreshToken);
        await user.save();
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async addAddress(userId, addressData) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    if (addressData.isDefault) {
      user.addresses.forEach((address) => {
        address.isDefault = false;
      });
    } else if (user.addresses.length === 0) {
      addressData.isDefault = true;
    }

    user.addresses.push(addressData);
    await user.save();

    await this.cacheUserProfile(this.buildUserProfile(user));

    const newAddress = user.addresses[user.addresses.length - 1];
    return this.buildAddress(newAddress);
  }

  async updateAddress(userId, addressId, addressData) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const address = user.addresses.id(addressId);
    if (!address) {
      const error = new Error('Address not found');
      error.code = 'ADDRESS_NOT_FOUND';
      throw error;
    }

    if (addressData.isDefault && !address.isDefault) {
      user.addresses.forEach((existingAddress) => {
        existingAddress.isDefault = false;
      });
    }

    Object.assign(address, addressData);
    await user.save();

    await this.cacheUserProfile(this.buildUserProfile(user));

    return this.buildAddress(address);
  }

  async removeAddress(userId, addressId) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const address = user.addresses.id(addressId);
    if (!address) {
      const error = new Error('Address not found');
      error.code = 'ADDRESS_NOT_FOUND';
      throw error;
    }

    const wasDefault = address.isDefault;
    user.addresses.pull(addressId);

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    await this.cacheUserProfile(this.buildUserProfile(user));

    return true;
  }

  async setDefaultAddress(userId, addressId) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const selectedAddress = user.addresses.id(addressId);
    if (!selectedAddress) {
      const error = new Error('Address not found');
      error.code = 'ADDRESS_NOT_FOUND';
      throw error;
    }

    user.addresses.forEach((address) => {
      address.isDefault = address._id.toString() === addressId;
    });

    await user.save();
    await this.cacheUserProfile(this.buildUserProfile(user));

    return true;
  }
}

module.exports = new UserService();
