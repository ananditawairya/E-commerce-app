/**
 * Builds cache key for one user profile.
 * @param {string} userId User id.
 * @return {string} Cache key.
 */
function getUserProfileCacheKey(userId) {
  return `auth:user:profile:${userId}`;
}

/**
 * Maps address document to API payload.
 * @param {object} address Address document.
 * @return {object} Address payload.
 */
function buildAddress(address) {
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

/**
 * Maps user document to profile payload.
 * @param {object} user User document.
 * @return {object} Profile payload.
 */
function buildUserProfile(user) {
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
    addresses: (user.addresses || []).map((address) => buildAddress(address)),
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Caches one user profile payload.
 * @param {{cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {object} profile Profile payload.
 * @return {Promise<void>} No return value.
 */
async function cacheUserProfile(deps, profile) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  if (!profile?.id) {
    return;
  }

  await cacheService.setJson(
    getUserProfileCacheKey(profile.id),
    profile,
    userProfileCacheTtlMs
  );
}

/**
 * Invalidates cached user profile payload.
 * @param {{cacheService: object}} deps Dependencies.
 * @param {string} userId User id.
 * @return {Promise<void>} No return value.
 */
async function invalidateUserProfileCache(deps, userId) {
  const { cacheService } = deps;
  if (!userId) {
    return;
  }

  await cacheService.delete(getUserProfileCacheKey(userId));
}

/**
 * Loads user document by id or throws USER_NOT_FOUND.
 * @param {{User: object}} deps Dependencies.
 * @param {string} userId User id.
 * @return {Promise<object>} User document.
 */
async function findUserByIdOrThrow(deps, userId) {
  const { User } = deps;
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  return user;
}

module.exports = {
  buildAddress,
  buildUserProfile,
  cacheUserProfile,
  findUserByIdOrThrow,
  getUserProfileCacheKey,
  invalidateUserProfileCache,
};
