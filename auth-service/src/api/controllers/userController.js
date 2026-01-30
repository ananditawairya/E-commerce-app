// backend/auth-service/src/api/controllers/userController.js
// CHANGE: REST API controller for user operations

const userService = require('../../services/userService');

class UserController {
  async register(req, res, next) {
    try {
      const { email, password, name, role } = req.body;

      // CHANGE: Centralized audit logging
      req.log.info({ email, role }, 'User registration attempt');

      const result = await userService.createUser({ email, password, name, role });

      // CHANGE: Audit log successful registration
      req.log.info({ userId: result.user.id, email, role }, 'User registered successfully');

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // CHANGE: Centralized audit logging
      req.log.info({ email }, 'User login attempt');

      const result = await userService.authenticateUser({ email, password });

      // CHANGE: Audit log successful login
      req.log.info({ userId: result.user.id, email }, 'User logged in successfully');

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async verifyToken(req, res, next) {
    try {
      const { token } = req.body;
      const result = await userService.verifyUserToken(token);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getMe(req, res, next) {
    try {
      const { token } = req.query;
      
      if (!token) {
        return res.status(400).json({
          code: 'MISSING_TOKEN',
          message: 'Token is required',
        });
      }

      const verification = await userService.verifyUserToken(token);
      if (!verification.valid) {
        return res.status(401).json({
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        });
      }

      const user = await userService.getUserById(verification.userId);
      res.json(user);
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await userService.refreshUserToken(refreshToken);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await userService.logoutUser(refreshToken);
      res.json({ success: result });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();