const {
  buildAddress,
  buildUserProfile,
  cacheUserProfile,
  findUserByIdOrThrow,
} = require('./helpers');

/**
 * Adds one address for user profile.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @param {object} addressData Address payload.
 * @return {Promise<object>} Newly created address.
 */
async function addAddress(deps, userId, addressData) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  const user = await findUserByIdOrThrow(deps, userId);

  if (addressData.isDefault) {
    user.addresses.forEach((address) => {
      address.isDefault = false;
    });
  } else if (user.addresses.length === 0) {
    addressData.isDefault = true;
  }

  user.addresses.push(addressData);
  await user.save();

  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

  const newAddress = user.addresses[user.addresses.length - 1];
  return buildAddress(newAddress);
}

/**
 * Updates one existing user address.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @param {string} addressId Address id.
 * @param {object} addressData Address payload.
 * @return {Promise<object>} Updated address.
 */
async function updateAddress(deps, userId, addressId, addressData) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  const user = await findUserByIdOrThrow(deps, userId);

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

  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

  return buildAddress(address);
}

/**
 * Removes one user address.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @param {string} addressId Address id.
 * @return {Promise<boolean>} True when removed.
 */
async function removeAddress(deps, userId, addressId) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  const user = await findUserByIdOrThrow(deps, userId);

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
  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

  return true;
}

/**
 * Sets one user address as default.
 * @param {{User: object, cacheService: object, userProfileCacheTtlMs: number}} deps Dependencies.
 * @param {string} userId User id.
 * @param {string} addressId Address id.
 * @return {Promise<boolean>} True when updated.
 */
async function setDefaultAddress(deps, userId, addressId) {
  const { cacheService, userProfileCacheTtlMs } = deps;
  const user = await findUserByIdOrThrow(deps, userId);

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
  await cacheUserProfile({ cacheService, userProfileCacheTtlMs }, buildUserProfile(user));

  return true;
}

module.exports = {
  addAddress,
  removeAddress,
  setDefaultAddress,
  updateAddress,
};
