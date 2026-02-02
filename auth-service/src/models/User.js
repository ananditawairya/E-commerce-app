// backend/auth-service/src/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  refreshTokens: [{
    token: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
}, {
  timestamps: true,
});

// CHANGE: Create indexes on email and username for faster lookups
userSchema.index({ email: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
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
userSchema.methods.comparePassword = async function(candidatePassword) {
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