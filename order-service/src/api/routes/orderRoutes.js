// backend/order-service/src/api/routes/orderRoutes.js
// REST API routes for order operations

const express = require('express');
const orderController = require('../controllers/orderController');
const {
  authenticateRestUser,
  requireBuyerRestUser,
  requireInternalService,
  requireSellerRestUser,
} = require('../../middleware/auth');

const buyerOrderRouter = express.Router();
const sellerOrderRouter = express.Router();
const authenticatedOrderRouter = express.Router();
const internalOrderRouter = express.Router();

const enforceBuyerOwnership = (paramKey) => (req, res, next) => {
  if (req.params[paramKey] !== req.user.userId) {
    return res.status(403).json({ error: 'Buyer can only access own resources' });
  }

  return next();
};

const enforceSellerOwnership = (paramKey) => (req, res, next) => {
  if (req.params[paramKey] !== req.user.userId) {
    return res.status(403).json({ error: 'Seller can only access own resources' });
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

// Buyer-protected routes
buyerOrderRouter.get(
  '/cart/:userId',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.getCart
);
buyerOrderRouter.post(
  '/cart/:userId/items',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.addToCart
);
buyerOrderRouter.put(
  '/cart/:userId/items',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.updateCartItem
);
buyerOrderRouter.delete(
  '/cart/:userId/items',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.removeFromCart
);
buyerOrderRouter.delete(
  '/cart/:userId',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.clearCart
);
buyerOrderRouter.post(
  '/orders/:userId',
  requireBuyerRestUser,
  enforceBuyerOwnership('userId'),
  orderController.createOrder
);
buyerOrderRouter.get(
  '/orders/buyer/:buyerId',
  requireBuyerRestUser,
  enforceBuyerOwnership('buyerId'),
  orderController.getOrdersByBuyer
);

// Seller-protected routes
sellerOrderRouter.get(
  '/orders/seller/:sellerId',
  requireSellerRestUser,
  enforceSellerOwnership('sellerId'),
  orderController.getOrdersBySeller
);
sellerOrderRouter.get(
  '/orders/seller/:sellerId/analytics',
  requireSellerRestUser,
  enforceSellerOwnership('sellerId'),
  orderController.getSellerAnalytics
);
sellerOrderRouter.put(
  '/orders/:id/status',
  requireSellerRestUser,
  attachSellerIdFromToken,
  orderController.updateOrderStatus
);
sellerOrderRouter.put(
  '/orders/:id/cancel',
  requireSellerRestUser,
  attachSellerIdFromToken,
  orderController.cancelOrder
);

// Authenticated routes (buyer or seller)
authenticatedOrderRouter.get('/orders/:id', authenticateRestUser, orderController.getOrder);

// Internal routes
internalOrderRouter.use(requireInternalService);
internalOrderRouter.get('/orders/:id', orderController.getOrder);

module.exports = {
  buyerOrderRouter,
  sellerOrderRouter,
  authenticatedOrderRouter,
  internalOrderRouter,
};
