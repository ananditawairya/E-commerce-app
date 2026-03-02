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
 * @return {Promise<boolean>} True when restored.
 */
async function restoreStock(
  deps,
  productId,
  variantId,
  quantity,
  orderId,
  correlationId
) {
  const { Product, kafkaProducer, cacheService } = deps;
  const product = await requireProduct({ Product }, productId);
  const variantIndex = product.variants.findIndex((item) => item._id === variantId);

  if (variantIndex === -1) {
    const error = new Error(`Variant ${variantId} not found in product ${productId}`);
    error.code = 'VARIANT_NOT_FOUND';
    throw error;
  }

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': variantId,
    },
    {
      $inc: { 'variants.$[elem].stock': quantity },
    },
    {
      arrayFilters: [{ 'elem._id': variantId }],
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
        variantId,
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
