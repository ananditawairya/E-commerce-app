const {
  buildUserProfile,
  cacheUserProfile,
  findUserByIdOrThrow,
  getUserProfileCacheKey,
} = require('./helpers');

/**
 * Fetches one user profile by id with cache-aside behavior.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @return {Promise<object>} Profile payload.
 */
async function getUserById(deps, userId) {
  const { User, cacheService, userProfileCacheTtlMs } = deps;
  const key = getUserProfileCacheKey(userId);

  const { value } = await cacheService.withJsonCache(
    key,
    userProfileCacheTtlMs,
    async () => {
      const user = await User.findById(userId).lean();
      if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      return buildUserProfile(user);
    }
  );

  return value;
}

/**
 * Updates mutable user profile fields.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @param {object} profileData Profile update payload.
 * @return {Promise<object>} Updated profile payload.
 */
async function updateUserProfile(deps, userId, profileData) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  const user = await findUserByIdOrThrow(deps, userId);

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

  const profile = buildUserProfile(user);
  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, profile);

  return profile;
}

module.exports = {
  getUserById,
  updateUserProfile,
};
