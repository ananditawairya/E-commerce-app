/**
 * Recommendation feature constants.
 */

const VALID_EVENT_TYPES = new Set([
  'view',
  'purchase',
  'cart_add',
  'cart_remove',
  'wishlist',
  'search',
]);

const EVENT_TYPE_ALIASES = {
  add_to_cart: 'cart_add',
  remove_from_cart: 'cart_remove',
  cartadded: 'cart_add',
  cartremoved: 'cart_remove',
};

const SIMILAR_PRODUCTS_SIGNAL_WEIGHTS = Object.freeze({
  embedding: 0.55,
  category: 0.2,
  coPurchase: 0.15,
  popularity: 0.1,
});

const SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE = Number.parseFloat(
  process.env.AI_SIMILAR_MIN_EMBEDDING_SCORE || '0.34'
);

module.exports = {
  EVENT_TYPE_ALIASES,
  SIMILAR_PRODUCTS_MIN_EMBEDDING_SCORE,
  SIMILAR_PRODUCTS_SIGNAL_WEIGHTS,
  VALID_EVENT_TYPES,
};
