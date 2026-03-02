// backend/auth-service/src/api/routes/userRoutes.js
// REST API routes for user operations

const express = require('express');
const userController = require('../controllers/userController');
const validate = require('../middleware/validate');
const authenticate = require('../middleware/auth');
const {
  registerSchema,
  loginSchema,
  verifyTokenSchema, refreshTokenSchema,
  addressSchema,
  profileUpdateSchema,
} = require('../middleware/validationSchemas');
const router = express.Router();


// RESTful endpoints for user operations
router.post('/register', validate(registerSchema, 'body'), userController.register);
router.post('/login', validate(loginSchema, 'body'), userController.login);
router.post('/verify-token', validate(verifyTokenSchema), userController.verifyToken);
router.get('/me', userController.getMe);
router.post('/refresh-token', validate(refreshTokenSchema), userController.refreshToken);
router.post('/logout', userController.logout);
router.get('/profile', authenticate, userController.getProfile);
router.patch('/profile', authenticate, validate(profileUpdateSchema, 'body'), userController.updateProfile);

// Address Management Routes
router.post('/addresses', authenticate, validate(addressSchema, 'body'), userController.addAddress);
router.put('/addresses/:addressId', authenticate, validate(addressSchema, 'body'), userController.updateAddress);
router.delete('/addresses/:addressId', authenticate, userController.removeAddress);
router.patch('/addresses/:addressId/default', authenticate, userController.setDefaultAddress);

module.exports = router;
