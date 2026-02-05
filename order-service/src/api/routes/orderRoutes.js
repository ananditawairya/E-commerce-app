// backend/order-service/src/api/routes/orderRoutes.js
// CHANGE: REST API routes for order operations

const express = require('express');
const orderController = require('../controllers/orderController');

const router = express.Router();

// CHANGE: RESTful endpoints for cart operations
router.get('/cart/:userId', orderController.getCart);
router.post('/cart/:userId/items', orderController.addToCart);
router.put('/cart/:userId/items', orderController.updateCartItem);
router.delete('/cart/:userId/items', orderController.removeFromCart);
router.delete('/cart/:userId', orderController.clearCart);

// CHANGE: RESTful endpoints for order operations
router.post('/orders/:userId', orderController.createOrder);
router.get('/orders/buyer/:buyerId', orderController.getOrdersByBuyer);
router.get('/orders/seller/:sellerId', orderController.getOrdersBySeller);
router.get('/orders/seller/:sellerId/analytics', orderController.getSellerAnalytics);
router.get('/orders/:id', orderController.getOrder);
router.put('/orders/:id/status', orderController.updateOrderStatus);
// CHANGE: Add cancel order endpoint
router.put('/orders/:id/cancel', orderController.cancelOrder);

module.exports = router;
