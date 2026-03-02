const {
  buildUserProfile,
  cacheUserProfile,
} = require('./helpers');

/**
 * Creates user account and returns auth tokens.
 * @param {{
 *   User: object,
 *   appLogger: object,
 *   generateTokens: Function,
 *   kafkaProducer: object,
 *   cacheService: object,
 *   userProfileCacheTtlMs: number,
 * }} deps Dependencies.
 * @param {{email: string, password: string, name: string, role: string}} input Registration payload.
 * @return {Promise<object>} Registration response.
 */
async function createUser(deps, input) {
  const {
    User,
    appLogger,
    generateTokens,
    kafkaProducer,
    cacheService,
    userProfileCacheTtlMs,
  } = deps;
  const { email, password, name, role } = input;

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

  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

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

/**
 * Authenticates user and returns fresh tokens.
 * @param {{
 *   User: object,
 *   generateTokens: Function,
 *   cacheService: object,
 *   userProfileCacheTtlMs: number,
 * }} deps Dependencies.
 * @param {{email: string, password: string}} input Login payload.
 * @return {Promise<object>} Login response.
 */
async function authenticateUser(deps, input) {
  const {
    User,
    generateTokens,
    cacheService,
    userProfileCacheTtlMs,
  } = deps;
  const { email, password } = input;

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

  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

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

/**
 * Verifies one access token.
 * @param {{verifyAccessToken: Function}} deps Dependencies.
 * @param {string} token Access token.
 * @return {Promise<{userId?: string, role?: string, valid: boolean}>} Verification payload.
 */
async function verifyUserToken(deps, token) {
  const { verifyAccessToken } = deps;

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

/**
 * Exchanges refresh token for fresh token pair.
 * @param {{
 *   User: object,
 *   generateTokens: Function,
 *   verifyRefreshToken: Function,
 * }} deps Dependencies.
 * @param {string} refreshToken Refresh token.
 * @return {Promise<{accessToken: string, refreshToken: string}>} New token pair.
 */
async function refreshUserToken(deps, refreshToken) {
  const { User, generateTokens, verifyRefreshToken } = deps;

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.userId);

    if (!user || !user.refreshTokens.some((tokenEntry) => tokenEntry.token === refreshToken)) {
      const error = new Error('Invalid refresh token');
      error.code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    const tokens = generateTokens({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    user.refreshTokens = user.refreshTokens.filter((tokenEntry) => tokenEntry.token !== refreshToken);
    user.refreshTokens.push({ token: tokens.refreshToken });
    await user.save();

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  } catch (error) {
    const wrappedError = new Error('Invalid refresh token');
    wrappedError.code = 'INVALID_REFRESH_TOKEN';
    throw wrappedError;
  }
}

/**
 * Logs out user by deleting refresh token.
 * @param {{User: object, verifyRefreshToken: Function}} deps Dependencies.
 * @param {string} refreshToken Refresh token.
 * @return {Promise<boolean>} True when logout succeeds.
 */
async function logoutUser(deps, refreshToken) {
  const { User, verifyRefreshToken } = deps;

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.userId);

    if (user) {
      user.refreshTokens = user.refreshTokens.filter((tokenEntry) => tokenEntry.token !== refreshToken);
      await user.save();
    }

    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  authenticateUser,
  createUser,
  logoutUser,
  refreshUserToken,
  verifyUserToken,
};
