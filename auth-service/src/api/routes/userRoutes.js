// backend/auth-service/src/api/routes/userRoutes.js
// CHANGE: REST API routes for user operations

const express = require('express');
const userController = require('../controllers/userController');
const validate = require('../middleware/validate');
const {
  registerSchema,
  loginSchema,
  verifyTokenSchema, refreshTokenSchema
} = require('../middleware/validationSchemas');
const router = express.Router();


// CHANGE: RESTful endpoints for user operations
router.post('/register',validate(registerSchema, 'body'), userController.register);
router.post('/login',  validate(loginSchema, 'body'), userController.login);
router.post('/verify-token', validate(verifyTokenSchema), userController.verifyToken);
router.get('/me', userController.getMe);
router.post('/refresh-token', validate(refreshTokenSchema), userController.refreshToken);
router.post('/logout', userController.logout);

module.exports = router;