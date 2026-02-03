// backend/product-service/src/api/routes/productRoutes.js
// CHANGE: REST API routes for product operations

const express = require('express');
const productController = require('../controllers/productController');

const router = express.Router();

// CHANGE: RESTful endpoints for product operations
router.get('/', productController.getProducts);
router.get('/categories', productController.getCategories);
router.get('/:id', productController.getProduct);
router.get('/seller/:sellerId', productController.getSellerProducts);
router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

// CHANGE: Add reservation management endpoints
router.post('/:id/reserve-stock', productController.reserveStock);
router.post('/:id/confirm-reservation', productController.confirmReservation);
router.post('/:id/release-reservation', productController.releaseReservation);

router.post('/:id/deduct-stock', productController.deductStock);
router.get('/:id/stock', productController.getStock);
// CHANGE: Add restore stock endpoint for order cancellations
router.post('/:id/restore-stock', productController.restoreStock);
// CHANGE: Add manual cleanup endpoint for testing
router.post('/:id/cleanup-expired-reservations', async (req, res, next) => {
  try {
    const productService = require('../../services/productService');
    await productService.cleanupAllExpiredReservations();
    res.json({ success: true, message: 'Cleanup completed' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;