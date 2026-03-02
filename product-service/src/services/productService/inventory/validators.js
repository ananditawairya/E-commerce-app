/**
 * Fetches product and validates its presence.
 * @param {{Product: object}} deps Dependencies.
 * @param {string} productId Product id.
 * @return {Promise<object>} Product document.
 */
async function requireProduct({ Product }, productId) {
  const product = await Product.findById(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  return product;
}

/**
 * Finds one variant and validates its presence.
 * @param {object} product Product document.
 * @param {string} variantId Variant id.
 * @return {object} Variant document.
 */
function requireVariant(product, variantId) {
  const variant = product.variants.find((item) => item._id === variantId);
  if (!variant) {
    const error = new Error('Variant not found');
    error.code = 'VARIANT_NOT_FOUND';
    throw error;
  }
  return variant;
}

module.exports = {
  requireProduct,
  requireVariant,
};
