// backend/product-service/src/api/routes/productRoutes.js
// REST API routes for product operations

const express = require('express');
const productController = require('../controllers/productController');
const {
  requireSellerRestUser,
  requireInternalService,
} = require('../../middleware/auth');

const publicProductRouter = express.Router();
const sellerProductRouter = express.Router();
const internalProductRouter = express.Router();

const enforceSellerOwnership = (req, res, next) => {
  if (req.params.sellerId !== req.user.userId) {
    return res.status(403).json({ error: 'Seller can only access own products' });
  }

  return next();
};

const attachSellerIdFromToken = (req, res, next) => {
  req.body = {
    ...req.body,
    sellerId: req.user.userId,
  };
  return next();
};

// Public catalog browsing routes
publicProductRouter.get('/', productController.getProducts);
publicProductRouter.get('/categories', productController.getCategories);
publicProductRouter.get('/search/suggestions', productController.getSearchSuggestions);
publicProductRouter.get('/semantic/status', productController.getSemanticSearchStatus);
publicProductRouter.get('/:id', productController.getProduct);

// Seller/admin routes
sellerProductRouter.use(requireSellerRestUser);
sellerProductRouter.get(
  '/seller/:sellerId',
  enforceSellerOwnership,
  productController.getSellerProducts
);
sellerProductRouter.post('/semantic/reindex', productController.reindexSemanticSearch);
sellerProductRouter.post('/', attachSellerIdFromToken, productController.createProduct);
sellerProductRouter.put('/:id', attachSellerIdFromToken, productController.updateProduct);
sellerProductRouter.delete('/:id', attachSellerIdFromToken, productController.deleteProduct);

// Internal service routes
internalProductRouter.use(requireInternalService);
internalProductRouter.post('/:id/deduct-stock', productController.deductStock);
internalProductRouter.get('/:id/stock', productController.getStock);
internalProductRouter.post('/:id/restore-stock', productController.restoreStock);

module.exports = {
  publicProductRouter,
  sellerProductRouter,
  internalProductRouter,
};
