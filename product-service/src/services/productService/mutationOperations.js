/**
 * Product create/update/delete operations.
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
 * Validates shared product payload constraints.
 * @param {object} sanitizedInput Sanitized product payload.
 * @param {boolean} requireVariants Whether variants are required.
 * @return {void} No return value.
 */
function validateProductPayload(sanitizedInput, requireVariants) {
  if (!sanitizedInput.name || !sanitizedInput.description || !sanitizedInput.category) {
    const error = new Error(
      'Missing required fields: name, description, and category are required'
    );
    error.code = 'MISSING_FIELDS';
    throw error;
  }

  if (typeof sanitizedInput.basePrice !== 'number' || sanitizedInput.basePrice < 0) {
    const error = new Error('Base price must be a valid positive number');
    error.code = 'INVALID_PRICE';
    throw error;
  }

  if (requireVariants && (!sanitizedInput.variants || sanitizedInput.variants.length === 0)) {
    const error = new Error('At least one product variant is required');
    error.code = 'MISSING_VARIANTS';
    throw error;
  }
}

/**
 * Validates each variant stock value.
 * @param {object[]} variants Variant payload list.
 * @return {void} No return value.
 */
function validateVariants(variants) {
  variants.forEach((variant, index) => {
    if (typeof variant.stock !== 'number' || variant.stock < 0) {
      const error = new Error(`Variant ${index + 1} must have a valid stock quantity`);
      error.code = 'INVALID_STOCK';
      throw error;
    }
  });
}

/**
 * Schedules semantic index + event publish after create.
 * @param {{
 *   productSemanticSearchService: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {object} product Product document.
 * @param {string|undefined} correlationId Correlation id.
 * @return {void} No return value.
 */
function schedulePostCreateTasks(deps, product, correlationId) {
  const {
    productSemanticSearchService,
    searchEngineService,
    kafkaProducer,
  } = deps;

  setImmediate(async () => {
    try {
      await productSemanticSearchService.upsertProductEmbedding(product.toJSON());
    } catch (error) {
      console.warn('Failed to upsert product search embedding after create:', error.message);
    }

    try {
      if (searchEngineService && searchEngineService.isEnabled()) {
        await searchEngineService.upsertProduct(product.toJSON());
      }
    } catch (error) {
      console.warn('Failed to upsert dedicated search document after create:', error.message);
    }

    try {
      await kafkaProducer.publishProductCreated(
        product.toJSON(),
        correlationId || `product-create-${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to publish product created event:', error);
    }
  });
}

/**
 * Schedules semantic index + event publish after update.
 * @param {{
 *   productSemanticSearchService: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {object} product Product document.
 * @param {string|undefined} correlationId Correlation id.
 * @return {void} No return value.
 */
function schedulePostUpdateTasks(deps, product, correlationId) {
  const {
    productSemanticSearchService,
    searchEngineService,
    kafkaProducer,
  } = deps;

  setImmediate(async () => {
    try {
      await productSemanticSearchService.upsertProductEmbedding(product.toJSON());
    } catch (error) {
      console.warn('Failed to upsert product search embedding after update:', error.message);
    }

    try {
      if (searchEngineService && searchEngineService.isEnabled()) {
        await searchEngineService.upsertProduct(product.toJSON());
      }
    } catch (error) {
      console.warn('Failed to upsert dedicated search document after update:', error.message);
    }

    try {
      await kafkaProducer.publishProductUpdated(
        product.toJSON(),
        correlationId || `product-update-${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to publish product updated event:', error);
    }
  });
}

/**
 * Creates a new product.
 * @param {{
 *   Product: object,
 *   sanitizeProductInput: (input: object) => object,
 *   productSemanticSearchService: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {string} sellerId Seller id.
 * @param {object} input Product payload.
 * @param {string|undefined} correlationId Correlation id.
 * @return {Promise<object>} Created product.
 */
async function createProduct(deps, sellerId, input, correlationId) {
  const {
    Product,
    sanitizeProductInput,
  } = deps;

  const sanitizedInput = sanitizeProductInput(input);
  validateProductPayload(sanitizedInput, true);
  validateVariants(sanitizedInput.variants);

  const product = new Product({
    ...sanitizedInput,
    sellerId,
  });
  await product.save();
  await invalidateCatalogCache(deps.cacheService);
  schedulePostCreateTasks(deps, product, correlationId);
  return product;
}

/**
 * Updates an existing product.
 * @param {{
 *   Product: object,
 *   sanitizeProductInput: (input: object) => object,
 *   productSemanticSearchService: object,
 *   kafkaProducer: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} sellerId Seller id.
 * @param {object} input Product payload.
 * @param {string|undefined} correlationId Correlation id.
 * @return {Promise<object>} Updated product.
 */
async function updateProduct(deps, productId, sellerId, input, correlationId) {
  const {
    Product,
    sanitizeProductInput,
  } = deps;

  const product = await Product.findOne({ _id: productId, sellerId });
  if (!product) {
    const error = new Error('Product not found or unauthorized');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }

  const sanitizedInput = sanitizeProductInput(input);
  if (sanitizedInput.variants !== undefined) {
    if (!sanitizedInput.variants || sanitizedInput.variants.length === 0) {
      const error = new Error('At least one product variant is required');
      error.code = 'MISSING_VARIANTS';
      throw error;
    }
    validateVariants(sanitizedInput.variants);
  }

  Object.assign(product, sanitizedInput);
  await product.save();
  await invalidateCatalogCache(deps.cacheService);
  schedulePostUpdateTasks(deps, product, correlationId);
  return product;
}

/**
 * Deletes one product owned by the seller.
 * @param {{
 *   Product: object,
 *   productSemanticSearchService: object,
 * }} deps Dependencies.
 * @param {string} productId Product id.
 * @param {string} sellerId Seller id.
 * @return {Promise<boolean>} True when deleted.
 */
async function deleteProduct(deps, productId, sellerId) {
  const {
    Product,
    searchEngineService,
    productSemanticSearchService,
  } = deps;

  const result = await Product.deleteOne({ _id: productId, sellerId });
  if (result.deletedCount === 0) {
    const error = new Error('Product not found or unauthorized');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }

  await invalidateCatalogCache(deps.cacheService);

  setImmediate(async () => {
    try {
      await productSemanticSearchService.removeProductEmbedding(productId);
    } catch (error) {
      console.warn('Failed to delete product search embedding after delete:', error.message);
    }

    try {
      if (searchEngineService && searchEngineService.isEnabled()) {
        await searchEngineService.deleteProduct(productId);
      }
    } catch (error) {
      console.warn('Failed to delete dedicated search document after delete:', error.message);
    }
  });

  return true;
}

module.exports = {
  createProduct,
  deleteProduct,
  updateProduct,
};
