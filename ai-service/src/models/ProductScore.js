// ai-service/src/models/ProductScore.js
// Pre-computed product scores for faster recommendations

const mongoose = require('mongoose');

const productScoreSchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    category: {
        type: String,
        index: true,
    },
    // Popularity metrics
    viewCount: {
        type: Number,
        default: 0,
    },
    purchaseCount: {
        type: Number,
        default: 0,
    },
    cartAddCount: {
        type: Number,
        default: 0,
    },
    // Computed scores
    trendingScore: {
        type: Number,
        default: 0,
        index: true,
    },
    // Last time this product was interacted with
    lastInteraction: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

// Compound indexes
productScoreSchema.index({ category: 1, trendingScore: -1 });
productScoreSchema.index({ trendingScore: -1 });

productScoreSchema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('ProductScore', productScoreSchema);
