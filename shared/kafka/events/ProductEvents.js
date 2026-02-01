// backend/shared/kafka/events/ProductEvents.js
// CHANGE: Complete product event schemas

const TOPICS = {
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  STOCK_DEDUCTED: 'product.stock.deducted',
};

// CHANGE: Add ProductCreated event schema
const createProductCreatedEvent = (product) => ({
  eventType: 'ProductCreated',
  payload: {
    productId: product.id,
    sellerId: product.sellerId,
    name: product.name,
    category: product.category,
    basePrice: product.basePrice,
    variants: product.variants.map(v => ({
      variantId: v.id,
      name: v.name,
      stock: v.stock,
      sku: v.sku,
    })),
    createdAt: product.createdAt,
  },
});

// CHANGE: Add ProductUpdated event schema
const createProductUpdatedEvent = (product) => ({
  eventType: 'ProductUpdated',
  payload: {
    productId: product.id,
    sellerId: product.sellerId,
    name: product.name,
    category: product.category,
    basePrice: product.basePrice,
    variants: product.variants.map(v => ({
      variantId: v.id,
      name: v.name,
      stock: v.stock,
      sku: v.sku,
    })),
    updatedAt: product.updatedAt,
  },
});

const createStockDeductedEvent = (productId, variantId, quantity, orderId) => ({
  eventType: 'StockDeducted',
  payload: {
    productId,
    variantId,
    quantity,
    orderId,
    deductedAt: new Date().toISOString(),
  },
});

module.exports = {
  TOPICS,
  createProductCreatedEvent,
  createProductUpdatedEvent,
  createStockDeductedEvent,
};