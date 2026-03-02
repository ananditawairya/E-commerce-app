const {
  buildDocumentText,
  createHash,
} = require('./helpers');

/**
 * Upserts semantic vector for one product.
 * @param {{
 *   product: object,
 *   isEnabled: () => boolean,
 *   ProductSearchEmbedding: object,
 *   localEmbeddingService: object,
 * }} deps Dependencies.
 * @return {Promise<boolean>} True when index changed.
 */
async function upsertProductEmbedding({
  product,
  isEnabled,
  ProductSearchEmbedding,
  localEmbeddingService,
}) {
  if (!isEnabled() || !product?.id) {
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

/**
 * Removes semantic embedding for one product.
 * @param {{productId: string, ProductSearchEmbedding: object}} deps Dependencies.
 * @return {Promise<void>} Completion promise.
 */
async function removeProductEmbedding({ productId, ProductSearchEmbedding }) {
  if (!productId) {
    return;
  }
  await ProductSearchEmbedding.deleteOne({ productId });
}

/**
 * Rebuilds semantic index for active products.
 * @param {{
 *   isEnabled: () => boolean,
 *   Product: object,
 *   localEmbeddingService: object,
 *   maxProducts: number,
 *   upsertFn: (deps: object) => Promise<boolean>,
 * }} deps Dependencies.
 * @return {Promise<object>} Reindex summary.
 */
async function reindexAllActiveProducts({
  isEnabled,
  Product,
  localEmbeddingService,
  maxProducts,
  upsertFn,
}) {
  if (!isEnabled()) {
    return {
      enabled: false,
      totalProducts: 0,
      indexed: 0,
      skipped: 0,
    };
  }

  const products = await Product.find({ isActive: true })
    .select('_id name description category basePrice variants createdAt updatedAt isActive')
    .limit(Math.max(1, maxProducts))
    .lean();

  let indexed = 0;
  let skipped = 0;

  for (const product of products) {
    try {
      const changed = await upsertFn({
        ...product,
        id: product._id,
      });
      if (changed) {
        indexed += 1;
      } else {
        skipped += 1;
      }
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

/**
 * Returns semantic index health/status details.
 * @param {{
 *   isEnabled: () => boolean,
 *   ProductSearchEmbedding: object,
 *   localEmbeddingService: object,
 * }} deps Dependencies.
 * @return {Promise<object>} Status payload.
 */
async function getStatus({
  isEnabled,
  ProductSearchEmbedding,
  localEmbeddingService,
}) {
  const model = localEmbeddingService.getModelName();
  const count = await ProductSearchEmbedding.countDocuments({
    isActive: true,
    embeddingModel: model,
  });

  return {
    enabled: isEnabled(),
    model,
    indexedProducts: count,
  };
}

module.exports = {
  getStatus,
  reindexAllActiveProducts,
  removeProductEmbedding,
  upsertProductEmbedding,
};
