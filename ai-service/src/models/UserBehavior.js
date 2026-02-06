// ai-service/src/models/UserBehavior.js
// Track user interactions for building recommendations

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userBehaviorSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => uuidv4(),
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  productId: {
    type: String,
    required: true,
    index: true,
  },
  eventType: {
    type: String,
    required: true,
    enum: ['view', 'purchase', 'cart_add', 'cart_remove', 'wishlist', 'search'],
    index: true,
  },
  category: {
    type: String,
    index: true,
  },
  metadata: {
    // Additional data like search query, variant selected, etc.
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  _id: false,
});

// Compound indexes for efficient queries
userBehaviorSchema.index({ userId: 1, eventType: 1, createdAt: -1 });
userBehaviorSchema.index({ productId: 1, eventType: 1 });
userBehaviorSchema.index({ category: 1, eventType: 1, createdAt: -1 });

// TTL index to automatically delete old events (90 days)
userBehaviorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

userBehaviorSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('UserBehavior', userBehaviorSchema);
