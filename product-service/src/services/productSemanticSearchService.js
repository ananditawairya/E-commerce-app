const crypto = require('crypto');

const Product = require('../models/Product');
const ProductSearchEmbedding = require('../models/ProductSearchEmbedding');
const localEmbeddingService = require('./localEmbeddingService');

const SEARCH_SEMANTIC_ENABLED = String(process.env.SEARCH_SEMANTIC_ENABLED || 'false').toLowerCase() === 'true';
const SEARCH_SEMANTIC_MAX_PRODUCTS = Number.parseInt(process.env.SEARCH_SEMANTIC_MAX_PRODUCTS || '800', 10);
const SEARCH_SEMANTIC_MIN_SCORE = Number.parseFloat(process.env.SEARCH_SEMANTIC_MIN_SCORE || '0.18');

const sanitizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createHash = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''))
  .digest('hex')
  .slice(0, 32);

const cosineSimilarityNormalized = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
};

const buildDocumentText = (product) => {
  const variantNames = (product.variants || [])
    .slice(0, 6)
    .map((variant) => sanitizeText(variant.name))
    .filter(Boolean)
    .join(', ');

  return sanitizeText([
    product.name,
    product.category,
    product.description,
    variantNames ? `variants ${variantNames}` : '',
    `price ${product.basePrice}`,
  ].join('. ')).slice(0, 1200);
};

class ProductSemanticSearchService {
  isEnabled() {
    return Boolean(SEARCH_SEMANTIC_ENABLED && localEmbeddingService.isEnabled());
  }

  buildFilter({ category, categories, minPrice, maxPrice, inStockOnly }) {
    const filter = { isActive: true };

    const normalizedCategories = Array.isArray(categories)
      ? [...new Set(
          categories
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
        )]
      : [];

    if (normalizedCategories.length > 0) {
      filter.category = { $in: normalizedCategories };
    } else if (typeof category === 'string' && category.trim()) {
      filter.category = category.trim();
    }

    const hasMinPrice = Number.isFinite(minPrice);
    const hasMaxPrice = Number.isFinite(maxPrice);
    if (hasMinPrice || hasMaxPrice) {
      filter.basePrice = {};
      if (hasMinPrice) filter.basePrice.$gte = Math.max(minPrice, 0);
      if (hasMaxPrice) filter.basePrice.$lte = Math.max(maxPrice, 0);
    }

    if (inStockOnly === true) {
      filter['variants.stock'] = { $gt: 0 };
    }

    return filter;
  }

  async upsertProductEmbedding(product) {
    if (!this.isEnabled() || !product?.id) {
      return false;
    }

    if (product.isActive === false) {
      await ProductSearchEmbedding.deleteOne({ productId: product.id });
      return false;
    }

    const documentText = buildDocumentText(product);
    if (!documentText) {
      return false;
    }

    const embeddingModel = localEmbeddingService.getModelName();
    const contentHash = createHash(`${documentText}:${embeddingModel}`);

    const existing = await ProductSearchEmbedding.findOne({
      productId: product.id,
      embeddingModel,
      contentHash,
      isActive: true,
    });
    if (existing) {
      return false;
    }

    const vector = await localEmbeddingService.embedText(documentText);
    if (!vector) {
      return false;
    }

    await ProductSearchEmbedding.findOneAndUpdate(
      { productId: product.id },
      {
        productId: product.id,
        embeddingModel,
        vector,
        contentHash,
        updatedAtSource: product.updatedAt || product.createdAt || new Date(),
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return true;
  }

  async removeProductEmbedding(productId) {
    if (!productId) {
      return;
    }
    await ProductSearchEmbedding.deleteOne({ productId });
  }

  async reindexAllActiveProducts() {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        totalProducts: 0,
        indexed: 0,
        skipped: 0,
      };
    }

    const products = await Product.find({ isActive: true })
      .select('_id name description category basePrice variants createdAt updatedAt isActive')
      .limit(Math.max(1, SEARCH_SEMANTIC_MAX_PRODUCTS))
      .lean();

    let indexed = 0;
    let skipped = 0;

    for (const product of products) {
      try {
        const changed = await this.upsertProductEmbedding({
          ...product,
          id: product._id,
        });
        if (changed) indexed += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
      }
    }

    return {
      enabled: true,
      totalProducts: products.length,
      indexed,
      skipped,
      model: localEmbeddingService.getModelName(),
    };
  }

  async getStatus() {
    const count = await ProductSearchEmbedding.countDocuments({
      isActive: true,
      embeddingModel: localEmbeddingService.getModelName(),
    });

    return {
      enabled: this.isEnabled(),
      model: localEmbeddingService.getModelName(),
      indexedProducts: count,
    };
  }

  /**
   * Scores a known candidate product set using semantic similarity.
   * @param {{
   *   search: string,
   *   candidateProductIds: string[],
   * }} params Candidate scoring params.
   * @return {Promise<Map<string, number>>} Product id -> semantic score map.
   */
  async scoreCandidateProducts({ search, candidateProductIds }) {
    const cleanSearch = sanitizeText(search);
    if (
      !cleanSearch
      || !this.isEnabled()
      || !Array.isArray(candidateProductIds)
      || candidateProductIds.length === 0
    ) {
      return new Map();
    }

    const normalizedIds = [...new Set(
      candidateProductIds
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )];
    if (normalizedIds.length === 0) {
      return new Map();
    }

    const queryVector = await localEmbeddingService.embedText(cleanSearch);
    if (!queryVector) {
      return new Map();
    }

    const embeddings = await ProductSearchEmbedding.find({
      productId: { $in: normalizedIds },
      isActive: true,
      embeddingModel: localEmbeddingService.getModelName(),
    })
      .select('+vector productId')
      .lean();

    const scores = new Map();
    for (const embedding of embeddings) {
      const score = cosineSimilarityNormalized(queryVector, embedding.vector);
      if (Number.isFinite(score)) {
        scores.set(embedding.productId, score);
      }
    }

    return scores;
  }

  async searchProducts({
    search,
    category,
    categories,
    minPrice,
    maxPrice,
    inStockOnly,
    limit = 20,
    offset = 0,
  }) {
    const cleanSearch = sanitizeText(search);
    if (!cleanSearch || !this.isEnabled()) {
      return [];
    }

    const queryVector = await localEmbeddingService.embedText(cleanSearch);
    if (!queryVector) {
      return [];
    }

    const filter = this.buildFilter({
      category,
      categories,
      minPrice,
      maxPrice,
      inStockOnly,
    });
    const candidates = await Product.find(filter)
      .select('_id sellerId name description category basePrice images variants isActive createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(Math.max(limit + offset, 20) * 6)
      .lean();

    if (candidates.length === 0) {
      return [];
    }

    const candidateIds = candidates.map((product) => product._id);
    const embeddings = await ProductSearchEmbedding.find({
      productId: { $in: candidateIds },
      isActive: true,
      embeddingModel: localEmbeddingService.getModelName(),
    })
      .select('+vector productId')
      .lean();

    const vectorByProductId = new Map();
    embeddings.forEach((entry) => {
      vectorByProductId.set(entry.productId, entry.vector);
    });

    const scored = candidates
      .map((product) => {
        const vector = vectorByProductId.get(product._id);
        const score = cosineSimilarityNormalized(queryVector, vector);
        return {
          product,
          score,
        };
      })
      .filter((entry) => Number.isFinite(entry.score) && entry.score >= SEARCH_SEMANTIC_MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return [];
    }

    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = clamp(limit, 1, 50);

    return scored
      .slice(normalizedOffset, normalizedOffset + normalizedLimit)
      .map((entry) => {
        const product = entry.product;
        // .lean() skips Mongoose toJSON transform, so map _id → id manually
        const mapped = {
          ...product,
          id: product.id || product._id,
          semanticScore: Number(entry.score.toFixed(4)),
        };
        delete mapped._id;
        delete mapped.__v;

        if (Array.isArray(mapped.variants)) {
          mapped.variants = mapped.variants.map((variant) => {
            const v = { ...variant, id: variant.id || variant._id };
            delete v._id;
            return v;
          });
        }

        return mapped;
      });
  }
}

module.exports = new ProductSemanticSearchService();
