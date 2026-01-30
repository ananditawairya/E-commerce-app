// backend/order-service/src/models/Cart.js

const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
  },
  variantId: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
  },
});

const cartSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  items: [cartItemSchema],
}, {
  timestamps: true,
});

// CHANGE: Configure toJSON to map _id to id for GraphQL compatibility
cartSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    // CHANGE: Transform cart items to include id field
    if (ret.items) {
      ret.items = ret.items.map(item => ({
        ...item,
        id: item._id ? item._id.toString() : `${item.productId}-${item.variantId || 'default'}`,
      }));
    }
    return ret;
  }
});

module.exports = mongoose.model('Cart', cartSchema);