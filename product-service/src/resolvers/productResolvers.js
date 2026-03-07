const axios = require('axios');

const { requireSeller } = require('../middleware/auth');
const { formatDescriptionToBullets } = require('../utils/descriptionFormatter');
const {
  API_BASE_URL,
  INTERNAL_API_BASE_URL,
} = require('./productResolvers/constants');
const {
  getErrorMessage,
  getParentProductFromVariantInfo,
  normalizeId,
} = require('./productResolvers/helpers');
const { createQueryResolvers } = require('./productResolvers/queries');
const { createMutationResolvers } = require('./productResolvers/mutations');
const { createTypeResolvers } = require('./productResolvers/typeResolvers');

const Query = createQueryResolvers({
  axios,
  requireSeller,
  API_BASE_URL,
  getErrorMessage,
});

const Mutation = createMutationResolvers({
  axios,
  requireSeller,
  API_BASE_URL,
  INTERNAL_API_BASE_URL,
  getErrorMessage,
});

const { Product, Variant } = createTypeResolvers({
  formatDescriptionToBullets,
  normalizeId,
  getParentProductFromVariantInfo,
});

module.exports = {
  Query,
  Mutation,
  Product,
  Variant,
};
