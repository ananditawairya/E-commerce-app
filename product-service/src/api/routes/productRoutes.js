// backend/product-service/src/api/routes/productRoutes.js
// REST API routes for product operations

const express = require('express');
const productController = require('../controllers/productController');

const router = express.Router();

// RESTful endpoints for product operations
router.get('/', productController.getProducts);
router.get('/categories', productController.getCategories);
router.get('/search/suggestions', productController.getSearchSuggestions);
router.get('/semantic/status', productController.getSemanticSearchStatus);
router.post('/semantic/reindex', productController.reindexSemanticSearch);
router.get('/:id', productController.getProduct);
router.get('/seller/:sellerId', productController.getSellerProducts);
router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
router.post('/:id/deduct-stock', productController.deductStock);
router.get('/:id/stock', productController.getStock);
// Add restore stock endpoint for order cancellations
router.post('/:id/restore-stock', productController.restoreStock);

module.exports = router;
