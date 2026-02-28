// backend/auth-service/src/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userPreferencesSchema = new mongoose.Schema({
  language: {
    type: String,
    default: 'en-US',
    trim: true,
    maxlength: 10,
  },
  currency: {
    type: String,
    default: 'USD',
    trim: true,
    uppercase: true,
    maxlength: 3,
  },
  timezone: {
    type: String,
    default: 'UTC',
    trim: true,
    maxlength: 64,
  },
  marketingEmails: {
    type: Boolean,
    default: false,
  },
  orderUpdates: {
    type: Boolean,
    default: true,
  },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
  },
  role: {
    type: String,
    enum: ['buyer', 'seller'],
    required: true,
  },
  name: {
    type: String,
    required: true,
    minlength: 3,
    maxlength: 30,
  },
  phoneNumber: {
    type: String,
    trim: true,
    default: null,
  },
  avatarUrl: {
    type: String,
    trim: true,
    default: null,
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 280,
    default: '',
  },
  dateOfBirth: {
    type: Date,
    default: null,
  },
  preferences: {
    type: userPreferencesSchema,
    default: () => ({}),
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  refreshTokens: [{
    token: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
  addresses: [{
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  }],
}, {
  timestamps: true,
});

// CHANGE: Create indexes on email and username for faster lookups
userSchema.index({ email: 1 });
userSchema.index({ phoneNumber: 1 }, { sparse: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// CHANGE: Configure toJSON to map _id to id and enable virtuals
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    // CHANGE: Map MongoDB _id to GraphQL id field
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    delete ret.refreshTokens;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
