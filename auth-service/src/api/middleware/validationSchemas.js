const Joi = require('joi');

// User registration validation schema
const registerSchema = Joi.object({
  name: Joi.string()
    .pattern(/^[a-zA-Z\s'-]+$/)
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.pattern.base': 'User name must only contain letters, spaces, hyphens, and apostrophes',
      'string.min': 'User name must be at least 3 characters long',
      'string.max': 'User name cannot exceed 30 characters',
      'any.required': 'User name is required'
    }),
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'any.required': 'Password is required'
    }),
  role: Joi.string()
    .valid('buyer', 'seller')
    // CHANGE: Updated default and valid values to match User model schema
    .default('buyer')
    .messages({
      'any.only': 'Role must be either buyer or seller'
    })
});

// User login validation schema
const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    })
});

const verifyTokenSchema = Joi.object({
  token: Joi.string().required().messages({
    'string.empty': 'Token is required',
    'any.required': 'Token is required'
  })
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'string.empty': 'Refresh token is required',
    'any.required': 'Refresh token is required'
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyTokenSchema,
  refreshTokenSchema
};