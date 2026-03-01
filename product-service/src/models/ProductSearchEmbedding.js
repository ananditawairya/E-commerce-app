const mongoose = require('mongoose');

const productSearchEmbeddingSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  embeddingModel: {
    type: String,
    required: true,
    index: true,
  },
  vector: {
    type: [Number],
    required: true,
    select: false,
  },
  contentHash: {
    type: String,
    required: true,
    index: true,
  },
  updatedAtSource: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
}, {
  timestamps: true,
});

productSearchEmbeddingSchema.index({ isActive: 1, embeddingModel: 1, updatedAt: -1 });

module.exports = mongoose.model('ProductSearchEmbedding', productSearchEmbeddingSchema);

