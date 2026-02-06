// ai-service/src/models/ProductEmbedding.js
// Stores semantic embeddings for product retrieval.

const mongoose = require('mongoose');

const productEmbeddingSchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    name: {
        type: String,
        default: '',
    },
    category: {
        type: String,
        index: true,
    },
    basePrice: {
        type: Number,
        default: 0,
        index: true,
    },
    stock: {
        type: Number,
        default: 0,
        index: true,
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    embedding: {
        type: [Number],
        default: [],
        select: false,
    },
    embeddingModel: {
        type: String,
        default: 'text-embedding-004',
    },
    contentHash: {
        type: String,
        index: true,
    },
    updatedAtSource: {
        type: Date,
        default: null,
    },
    lastEmbeddedAt: {
        type: Date,
        default: Date.now,
    },
    metadata: {
        variantCount: {
            type: Number,
            default: 0,
        },
        imageCount: {
            type: Number,
            default: 0,
        },
    },
}, {
    timestamps: true,
});

productEmbeddingSchema.index({ isActive: 1, category: 1, basePrice: 1, stock: 1 });
productEmbeddingSchema.index({ updatedAt: -1 });

productEmbeddingSchema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.embedding;
        return ret;
    },
});

module.exports = mongoose.model('ProductEmbedding', productEmbeddingSchema);
