/**
 * Inventory operation aggregator for product service.
 */

const {
  reserveStock,
  confirmReservation,
  releaseReservation,
} = require('./inventory/reservationOperations');
const {
  deductStock,
  restoreStock,
  getProductStock,
} = require('./inventory/stockOperations');

module.exports = {
  confirmReservation,
  deductStock,
  getProductStock,
  releaseReservation,
  reserveStock,
  restoreStock,
};
