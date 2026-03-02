/**
 * Applies local fallback filtering/sorting for legacy product query shape.
 * @param {{
 *   products: object[],
 *   minPrice: number|null,
 *   maxPrice: number|null,
 *   inStockOnly: boolean,
 *   sortBy: string,
 *   limit: number,
 *   getTotalStock: (product: object) => number,
 * }} params Fallback params.
 * @return {object[]} Filtered products.
 */
function applyLegacyFiltersAndSorting({
  products,
  minPrice,
  maxPrice,
  inStockOnly,
  sortBy,
  limit,
  getTotalStock,
}) {
  let nextProducts = Array.isArray(products) ? [...products] : [];

  if (typeof minPrice === 'number') {
    nextProducts = nextProducts.filter((product) => product.basePrice >= minPrice);
  }

  if (typeof maxPrice === 'number') {
    nextProducts = nextProducts.filter((product) => product.basePrice <= maxPrice);
  }

  if (inStockOnly) {
    nextProducts = nextProducts.filter((product) => getTotalStock(product) > 0);
  }

  switch (sortBy) {
    case 'PRICE_LOW_TO_HIGH':
      nextProducts.sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));
      break;
    case 'PRICE_HIGH_TO_LOW':
      nextProducts.sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0));
      break;
    case 'NAME_A_TO_Z':
      nextProducts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'NAME_Z_TO_A':
      nextProducts.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      break;
    case 'NEWEST':
      nextProducts.sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });
      break;
    case 'RELEVANCE':
    default:
      break;
  }

  return nextProducts.slice(0, limit);
}

module.exports = {
  applyLegacyFiltersAndSorting,
};
