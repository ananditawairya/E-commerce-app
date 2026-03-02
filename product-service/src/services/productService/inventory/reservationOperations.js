const { invalidateCatalogCache } = require('./cache');
const { requireProduct, requireVariant } = require('./validators');

/**
 * Reserves stock for a future order confirmation.
 * @param {{
 *   Product: object,
 *   uuidGenerator: () => string,
 *   cacheService?: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {number} quantity Quantity to reserve.
 * @param {string} orderId Order id.
 * @param {number=} reservationTimeoutMs Expiration timeout.
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
 * Confirms an active reservation as final stock deduction.
 * @param {{
 *   Product: object,
 *   kafkaProducer: object,
 *   cacheService?: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} variantId Variant id.
 * @param {string} reservationId Reservation id.
 * @param {string} orderId Order id.
 * @param {string=} correlationId Correlation id.
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
 * Releases an active reservation and restores stock.
 * @param {{Product: object, cacheService?: object}} deps Dependencies.
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

module.exports = {
  confirmReservation,
  releaseReservation,
  reserveStock,
};
