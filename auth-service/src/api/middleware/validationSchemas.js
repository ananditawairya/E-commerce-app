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
    // Updated default and valid values to match User model schema
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

const addressSchema = Joi.object({
  street: Joi.string().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  zipCode: Joi.string().required(),
  country: Joi.string().required(),
  isDefault: Joi.boolean().optional(),
});

const profilePreferenceSchema = Joi.object({
  language: Joi.string()
    .pattern(/^[a-z]{2}(-[A-Z]{2})?$/)
    .messages({
      'string.pattern.base': 'Language must be in BCP-47 style format (example: en-US)',
    }),
  currency: Joi.string()
    .length(3)
    .uppercase()
    .messages({
      'string.length': 'Currency must be a 3-letter ISO code',
    }),
  timezone: Joi.string()
    .max(64),
  marketingEmails: Joi.boolean(),
  orderUpdates: Joi.boolean(),
});

const profileUpdateSchema = Joi.object({
  name: Joi.string()
    .pattern(/^[a-zA-Z\s'-]+$/)
    .min(3)
    .max(30),
  phoneNumber: Joi.string()
    .pattern(/^\+?[1-9]\d{7,14}$/)
    .allow(null)
    .messages({
      'string.pattern.base': 'Phone number must be E.164 compatible (example: +14155552671)',
    }),
  avatarUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .allow(null),
  bio: Joi.string()
    .max(280)
    .allow(''),
  dateOfBirth: Joi.date()
    .max('now')
    .allow(null)
    .messages({
      'date.max': 'Date of birth cannot be in the future',
    }),
  preferences: profilePreferenceSchema,
}).min(1).messages({
  'object.min': 'At least one profile field must be provided',
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyTokenSchema,
  refreshTokenSchema,
  addressSchema,
  profileUpdateSchema,
};
