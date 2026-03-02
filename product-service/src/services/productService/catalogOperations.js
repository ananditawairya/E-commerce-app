/**
 * Product catalog read operations.
 */

const productQueries = require('./catalog/productQueries');
const suggestionQueries = require('./catalog/suggestions');
const semanticOperations = require('./catalog/semantic');

module.exports = {
  ...productQueries,
  ...suggestionQueries,
  ...semanticOperations,
};
