/**
 * Creates GraphQL type resolvers.
 * @param {{
 *   formatDescriptionToBullets: (description: string) => string[],
 *   normalizeId: (value: unknown) => string|null,
 *   getParentProductFromVariantInfo: (info: object) => object|null,
 * }} deps Dependencies.
 * @return {{Product: object, Variant: object}} Type resolver map.
 */
function createTypeResolvers({
  formatDescriptionToBullets,
  normalizeId,
  getParentProductFromVariantInfo,
}) {
  return {
    Product: {
      id: (product) => normalizeId(product.id) || normalizeId(product._id),
      variants: (product) => product.variants || [],
      formattedDescription: (product) => formatDescriptionToBullets(product.description),
    },
    Variant: {
      id: (variant) => (
        normalizeId(variant.id)
        || normalizeId(variant._id)
        || normalizeId(variant.sku)
      ),
      effectiveDescription: (variant, _, __, info) => {
        const product = getParentProductFromVariantInfo(info);
        return variant.description || (product ? product.description : '');
      },
      effectiveImages: (variant, _, __, info) => {
        const product = getParentProductFromVariantInfo(info);
        return variant.images && variant.images.length > 0
          ? variant.images
          : (product ? product.images : []);
      },
      effectivePrice: (variant, _, __, info) => {
        const product = getParentProductFromVariantInfo(info);
        if (!product || typeof product.basePrice !== 'number') {
          return variant.priceModifier || 0;
        }
        return product.basePrice + (variant.priceModifier || 0);
      },
    },
  };
}

module.exports = {
  createTypeResolvers,
};
