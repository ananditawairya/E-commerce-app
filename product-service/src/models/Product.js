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
  },
  images: [{
    type: String,
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
  }],
  variants: {
    type: [variantSchema],
    required: true,
    validate: {
      validator: function(variants) {
        return variants && variants.length > 0;
      },
      message: 'At least one product variant is required'
    }
  },
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
  if (!this.variants || this.variants.length === 0) {
    return next(new Error('At least one product variant is required'));
  }

  this.variants.forEach((variant, index) => {
    if (!variant._id) {
      variant._id = uuidv4();
    }
    
    if (!variant.sku) {
      const sellerId = this.sellerId.substring(0, 4).toUpperCase();
      const productId = this._id.substring(0, 8).toUpperCase();
      const variantId = variant._id.substring(0, 8).toUpperCase();
      const timestamp = Date.now().toString().slice(-4);
      variant.sku = `${sellerId}-${productId}-${variantId}-${timestamp}`;
    }
  });
  
  next();
});

// CHANGE: Configure toJSON to map _id to id for both Product and Variant
productSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    // CHANGE: Map MongoDB _id to GraphQL id field
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    
    // CHANGE: Transform variants array to include id field
    if (ret.variants && Array.isArray(ret.variants)) {
      ret.variants = ret.variants.map(variant => {
        const transformedVariant = { ...variant };
        transformedVariant.id = transformedVariant._id;
        delete transformedVariant._id;
        return transformedVariant;
      });
    }
    
    return ret;
  }
});

// CHANGE: Configure toObject similarly for consistency
productSchema.set('toObject', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    
    if (ret.variants && Array.isArray(ret.variants)) {
      ret.variants = ret.variants.map(variant => {
        const transformedVariant = { ...variant };
        transformedVariant.id = transformedVariant._id;
        delete transformedVariant._id;
        return transformedVariant;
      });
    }
    
    return ret;
  }
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