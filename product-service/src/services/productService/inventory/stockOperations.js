const { invalidateCatalogCache } = require('./cache');
const { requireProduct, requireVariant } = require('./validators');

/**
 * Deducts stock directly without reservation lifecycle.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 *   cacheService?: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to deduct.
 * @param {string} orderId Order id.
 * @param {string=} correlationId Correlation id.
 * @return {Promise<boolean>} True when deducted.
 */
async function deductStock(
  deps,
  productId,
  variantId,
  quantity,
  orderId,
  correlationId
) {
  const { Product, kafkaProducer, cacheService } = deps;
  const product = await requireProduct({ Product }, productId);
  const variant = requireVariant(product, variantId);

  if (variant.stock < quantity) {
    const error = new Error(
      `Insufficient stock. Available: ${variant.stock}, Requested: ${quantity}`
    );
    error.code = 'INSUFFICIENT_STOCK';
    error.available = variant.stock;
    error.requested = quantity;
    throw error;
  }

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': variantId,
      'variants.stock': { $gte: quantity },
    },
    {
      $inc: { 'variants.$[elem].stock': -quantity },
    },
    {
      arrayFilters: [{ 'elem._id': variantId }],
    }
  );

  if (updateResult.modifiedCount === 0) {
    const error = new Error('Stock deduction failed. Stock may have changed during transaction');
    error.code = 'STOCK_DEDUCTION_FAILED';
    throw error;
  }

  await invalidateCatalogCache(cacheService);

  setImmediate(async () => {
    try {
      await kafkaProducer.publishStockDeducted(
        productId,
        variantId,
        quantity,
        orderId,
        correlationId || `stock-deduct-${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to publish stock deducted event:', error);
    }
  });

  return true;
}

/**
 * Resolves target variant id for stock restoration.
 * Falls back to variant name and single-variant products for compatibility.
 * @param {object} product Product document.
 * @param {string} variantId Original order variant id.
 * @param {string=} variantName Original order variant name.
 * @return {string|null} Resolved variant id.
 */
function resolveRestoreVariantId(product, variantId, variantName) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  const exact = variants.find((item) => item._id === variantId);
  if (exact) {
    return exact._id;
  }

  const normalizedVariantName = typeof variantName === 'string' ? variantName.trim() : '';
  if (normalizedVariantName) {
    const nameMatches = variants.filter((item) => item.name === normalizedVariantName);
    if (nameMatches.length === 1) {
      return nameMatches[0]._id;
    }
  }

  if (variants.length === 1) {
    return variants[0]._id;
  }

  return null;
}

/**
 * Restores stock, typically after cancellation/compensation.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 *   cacheService?: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to restore.
 * @param {string} orderId Order id.
 * @param {string=} correlationId Correlation id.
 * @param {string=} variantName Variant name fallback.
 * @return {Promise<boolean>} True when restored.
 */
async function restoreStock(
  deps,
  productId,
  variantId,
  quantity,
  orderId,
  correlationId,
  variantName
) {
  const { Product, kafkaProducer, cacheService } = deps;
  const product = await requireProduct({ Product }, productId);
  const resolvedVariantId = resolveRestoreVariantId(product, variantId, variantName);

  if (!resolvedVariantId) {
    const error = new Error(
      `Variant ${variantId} not found in product ${productId} during stock restoration`
    );
    error.code = 'VARIANT_NOT_FOUND';
    throw error;
  }

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': resolvedVariantId,
    },
    {
      $inc: { 'variants.$[elem].stock': quantity },
    },
    {
      arrayFilters: [{ 'elem._id': resolvedVariantId }],
    }
  );

  if (updateResult.modifiedCount === 0) {
    const error = new Error('Stock restoration failed');
    error.code = 'STOCK_RESTORATION_FAILED';
    throw error;
  }

  await invalidateCatalogCache(cacheService);

  setImmediate(async () => {
    try {
      await kafkaProducer.publishStockRestored(
        productId,
        resolvedVariantId,
        quantity,
        orderId,
        correlationId || `stock-restore-${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to publish stock restored event:', error);
    }
  });

  return true;
}

/**
 * Retrieves stock for product or one variant.
 * @param {{Product: object}} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string=} variantId Variant id.
 * @return {Promise<object>} Stock payload.
 */
async function getProductStock(deps, productId, variantId) {
  const { Product } = deps;
  const product = await requireProduct({ Product }, productId);

  if (variantId) {
    const variant = requireVariant(product, variantId);
    return {
      productId,
      productName: product.name,
      variantId,
      variantName: variant.name,
      stock: variant.stock,
      sellerId: product.sellerId,
    };
  }

  const totalStock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
  return {
    productId,
    productName: product.name,
    stock: totalStock,
    sellerId: product.sellerId,
  };
}

module.exports = {
  deductStock,
  getProductStock,
  restoreStock,
};
