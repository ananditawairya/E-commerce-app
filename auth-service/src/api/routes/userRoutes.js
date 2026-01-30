// backend/auth-service/src/api/routes/userRoutes.js
// CHANGE: REST API routes for user operations

const express = require('express');
const userController = require('../controllers/userController');

const router = express.Router();

// CHANGE: RESTful endpoints for user operations
router.post('/register', userController.register);
router.post('/login', userController.login);
router.post('/verify-token', userController.verifyToken);
router.get('/me', userController.getMe);
router.post('/refresh-token', userController.refreshToken);
router.post('/logout', userController.logout);

module.exports = router;