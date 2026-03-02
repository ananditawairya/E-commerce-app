const { buildMutationResolvers } = require('./orderResolvers/mutations');
const { buildQueryResolvers } = require('./orderResolvers/queries');

/**
 * GraphQL resolver map for order domain.
 */
const resolvers = {
  Cart: {
    /**
     * Computes cart total amount.
     * @param {{items: Array<{price: number, quantity: number}>}} cart Cart payload.
     * @return {number} Total cart amount.
     */
    totalAmount: (cart) => {
      return cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    },
  },
  Query: buildQueryResolvers(),
  Mutation: buildMutationResolvers(),
};

module.exports = resolvers;
