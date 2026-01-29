// backend/product-service/src/models/Product.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const variantSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => uuidv4(),
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    trim: true,
    // Optional: variant-specific description overrides product description
  },
  images: [{
    type: String,
    // Optional: variant-specific images override product images
  }],
  priceModifier: {
    type: Number,
    default: 0,
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
  },
  sku: {
    type: String,
    unique: true,
    sparse: true,
  },
}, { _id: false });

const productSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => uuidv4(),
  },
  sellerId: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    // Base description - can be overridden by variant description
  },
  category: {
    type: String,
    required: true,
    index: true,
  },
  basePrice: {
    type: Number,
    required: true,
    min: 0,
  },
  images: [{
    type: String,
    // Base images - can be overridden by variant images
  }],
  variants: [variantSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  _id: false,
});

// Pre-save hook to generate SKUs for variants
productSchema.pre('save', function(next) {
  // Generate SKUs for variants that don't have them
  if (this.variants && this.variants.length > 0) {
    this.variants.forEach((variant, index) => {
      // Ensure variant has an ID
      if (!variant._id) {
        variant._id = uuidv4();
      }
      
      // Generate SKU if not provided
      if (!variant.sku) {
        const sellerId = this.sellerId.substring(0, 4).toUpperCase();
        const productId = this._id.substring(0, 8).toUpperCase();
        const variantId = variant._id.substring(0, 8).toUpperCase();
        const timestamp = Date.now().toString().slice(-4);
        variant.sku = `${sellerId}-${productId}-${variantId}-${timestamp}`;
      }
    });
  }
  next();
});

// Virtual method to get effective description for a variant
variantSchema.virtual('effectiveDescription').get(function() {
  return this.description || this.parent().description;
});

// Virtual method to get effective images for a variant
variantSchema.virtual('effectiveImages').get(function() {
  return this.images && this.images.length > 0 ? this.images : this.parent().images;
});

// Text index for search
productSchema.index({ name: 'text', description: 'text', category: 'text' });
productSchema.index({ sellerId: 1, createdAt: -1 });
productSchema.index({ isActive: 1, category: 1 });

module.exports = mongoose.model('Product', productSchema);