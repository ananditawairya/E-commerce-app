/**
 * Product inventory and reservation operations.
 */

const CATALOG_NAMESPACE = 'catalog';

/**
 * Bumps catalog namespace to invalidate stale cache keys.
 * @param {object|undefined} cacheService Cache service.
 * @return {Promise<void>} Completion promise.
 */
async function invalidateCatalogCache(cacheService) {
  if (!cacheService || typeof cacheService.bumpNamespaceVersion !== 'function') {
    return;
  }

  try {
    await cacheService.bumpNamespaceVersion(CATALOG_NAMESPACE);
  } catch (error) {
    console.warn('Failed to invalidate product catalog cache namespace:', error.message);
  }
}

/**
 * Fetches product and validates its presence.
 * @param {{Product: object}} deps Dependencies.
 * @param {string} productId Product id.
 * @return {Promise<object>} Product document.
 */
async function requireProduct({ Product }, productId) {
  const product = await Product.findById(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  return product;
}

/**
 * Finds one variant and validates its presence.
 * @param {object} product Product document.
 * @param {string} variantId Variant id.
 * @return {object} Variant document.
 */
function requireVariant(product, variantId) {
  const variant = product.variants.find((item) => item._id === variantId);
  if (!variant) {
    const error = new Error('Variant not found');
    error.code = 'VARIANT_NOT_FOUND';
    throw error;
  }
  return variant;
}

/**
 * Reserves stock for a future order confirmation.
 * @param {{
 *   Product: object,
 *   uuidGenerator: () => string,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to reserve.
 * @param {string} orderId Order id.
 * @param {number} reservationTimeoutMs Expiration timeout.
 * @return {Promise<object>} Reservation metadata.
 */
async function reserveStock(
  deps,
  productId,
  variantId,
  quantity,
  orderId,
  reservationTimeoutMs = 300000
) {
  const { Product, uuidGenerator, cacheService } = deps;
  const reservationId = uuidGenerator();
  const expiresAt = new Date(Date.now() + reservationTimeoutMs);

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': variantId,
      'variants.stock': { $gte: quantity },
    },
    {
      $inc: { 'variants.$[variant].stock': -quantity },
      $push: {
        'variants.$[variant].reservations': {
          reservationId,
          orderId,
          quantity,
          expiresAt,
          status: 'active',
        },
      },
    },
    {
      arrayFilters: [{ 'variant._id': variantId }],
    }
  );

  if (updateResult.modifiedCount === 0) {
    const error = new Error('Insufficient stock for reservation');
    error.code = 'INSUFFICIENT_STOCK';
    throw error;
  }

  await invalidateCatalogCache(cacheService);

  console.log(
    `Stock reserved: ${quantity} units for order ${orderId} (reservation: ${reservationId})`
  );

  return {
    reservationId,
    productId,
    variantId,
    quantity,
    expiresAt,
    orderId,
  };
}

/**
 * Confirms an active reservation as a final deduction.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {string} reservationId Reservation id.
 * @param {string} orderId Order id.
 * @param {string|undefined} correlationId Correlation id.
 * @return {Promise<boolean>} True when confirmation succeeds.
 */
async function confirmReservation(
  deps,
  productId,
  variantId,
  reservationId,
  orderId,
  correlationId
) {
  const { Product, kafkaProducer, cacheService } = deps;
  const product = await requireProduct({ Product }, productId);
  const variant = requireVariant(product, variantId);
  const reservation = variant.reservations.find(
    (item) => item.reservationId === reservationId
  );

  if (!reservation || reservation.status !== 'active') {
    const error = new Error('Reservation not found or already processed');
    error.code = 'RESERVATION_NOT_FOUND';
    throw error;
  }

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': variantId,
      'variants.reservations.reservationId': reservationId,
      'variants.reservations.status': 'active',
    },
    {
      $set: {
        'variants.$[variant].reservations.$[reservation].status': 'confirmed',
      },
    },
    {
      arrayFilters: [
        { 'variant._id': variantId },
        { 'reservation.reservationId': reservationId },
      ],
    }
  );

  if (updateResult.modifiedCount === 0) {
    const error = new Error('Failed to confirm reservation');
    error.code = 'RESERVATION_CONFIRMATION_FAILED';
    throw error;
  }

  await invalidateCatalogCache(cacheService);

  setImmediate(async () => {
    try {
      await kafkaProducer.publishStockDeducted(
        productId,
        variantId,
        reservation.quantity,
        orderId,
        correlationId || `stock-confirm-${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to publish stock deducted event:', error);
    }
  });

  console.log(`Reservation confirmed: ${reservationId} - ${reservation.quantity} units deducted`);
  return true;
}

/**
 * Releases a reservation and restores stock.
 * @param {{Product: object}} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {string} reservationId Reservation id.
 * @return {Promise<boolean>} True when released.
 */
async function releaseReservation(deps, productId, variantId, reservationId) {
  const { Product, cacheService } = deps;

  const product = await Product.findById(productId);
  if (!product) {
    console.warn(`Product ${productId} not found for reservation release`);
    return false;
  }

  const variant = product.variants.find((item) => item._id === variantId);
  if (!variant) {
    console.warn(`Variant ${variantId} not found for reservation release`);
    return false;
  }

  const reservation = variant.reservations.find((item) => item.reservationId === reservationId);
  if (!reservation || reservation.status !== 'active') {
    console.warn(`Reservation ${reservationId} not found or already processed`);
    return false;
  }

  const updateResult = await Product.updateOne(
    {
      _id: productId,
      'variants._id': variantId,
      'variants.reservations.reservationId': reservationId,
      'variants.reservations.status': 'active',
    },
    {
      $inc: { 'variants.$[variant].stock': reservation.quantity },
      $set: {
        'variants.$[variant].reservations.$[reservation].status': 'released',
      },
    },
    {
      arrayFilters: [
        { 'variant._id': variantId },
        { 'reservation.reservationId': reservationId },
      ],
    }
  );

  if (updateResult.modifiedCount === 0) {
    console.warn(`Reservation ${reservationId} not found or already processed`);
    return false;
  }

  await invalidateCatalogCache(cacheService);

  console.log(`Reservation released: ${reservationId}`);
  return true;
}

/**
 * Deducts stock directly without reservation lifecycle.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to deduct.
 * @param {string} orderId Order id.
 * @param {string|undefined} correlationId Correlation id.
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
 * Restores stock, typically after a cancellation/compensation.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to restore.
 * @param {string} orderId Order id.
 * @param {string|undefined} correlationId Correlation id.
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
 * Retrieves stock for one product/variant scope.
 * @param {{Product: object}} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string|undefined} variantId Variant id.
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
  confirmReservation,
  deductStock,
  getProductStock,
  releaseReservation,
  reserveStock,
  restoreStock,
};
