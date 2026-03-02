const { normalizeStringArray } = require('./helpers');

/**
 * Builds Mongo filter from semantic search parameters.
 * @param {{
 *   category?: string,
 *   categories?: string[],
 *   minPrice?: number,
 *   maxPrice?: number,
 *   inStockOnly?: boolean,
 * }} params Filter params.
 * @return {object} MongoDB filter.
 */
function buildFilter({ category, categories, minPrice, maxPrice, inStockOnly }) {
  const filter = { isActive: true };
  const normalizedCategories = normalizeStringArray(categories);

  if (normalizedCategories.length > 0) {
    filter.category = { $in: normalizedCategories };
  } else if (typeof category === 'string' && category.trim()) {
    filter.category = category.trim();
  }

  const hasMinPrice = Number.isFinite(minPrice);
  const hasMaxPrice = Number.isFinite(maxPrice);
  if (hasMinPrice || hasMaxPrice) {
    filter.basePrice = {};
    if (hasMinPrice) {
      filter.basePrice.$gte = Math.max(minPrice, 0);
    }
    if (hasMaxPrice) {
      filter.basePrice.$lte = Math.max(maxPrice, 0);
    }
  }

  if (inStockOnly === true) {
    filter['variants.stock'] = { $gt: 0 };
  }

  return filter;
}

module.exports = {
  buildFilter,
};
