// backend/product-service/src/api/controllers/productController.js
const productService = require('../../services/productService');

const parseQueryStringArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

class ProductController {
  async getProducts(req, res, next) {
    try {
      const {
        search,
        category,
        categories,
        'categories[]': bracketedCategories,
        minPrice,
        maxPrice,
        inStockOnly,
        sortBy,
        limit,
        offset,
      } = req.query;

      const parsedLimit = Number.parseInt(limit, 10);
      const parsedOffset = Number.parseInt(offset, 10);
      const parsedMinPrice = Number.parseFloat(minPrice);
      const parsedMaxPrice = Number.parseFloat(maxPrice);
      const parsedCategories = parseQueryStringArray(
        categories || bracketedCategories
      );

      let parsedInStockOnly;
      if (inStockOnly === 'true') parsedInStockOnly = true;
      if (inStockOnly === 'false') parsedInStockOnly = false;

      const products = await productService.getProducts({
        search,
        category,
        categories: parsedCategories,
        minPrice: Number.isFinite(parsedMinPrice) ? parsedMinPrice : undefined,
        maxPrice: Number.isFinite(parsedMaxPrice) ? parsedMaxPrice : undefined,
        inStockOnly: parsedInStockOnly,
        sortBy,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
        offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      });
      res.json(products);
    } catch (error) {
      next(error);
    }
  }

  async getProduct(req, res, next) {
    try {
      const { id } = req.params;
      const product = await productService.getProductById(id);
      res.json(product);
    } catch (error) {
      next(error);
    }
  }

  async getSellerProducts(req, res, next) {
    try {
      const { sellerId } = req.params;
      
      req.log.info({ sellerId }, 'Fetching seller products');
      
      const products = await productService.getProductsBySeller(sellerId);
      res.json(products);
    } catch (error) {
      next(error);
    }
  }

  async getCategories(req, res, next) {
    try {
      const categories = await productService.getCategories();
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  async getSemanticSearchStatus(req, res, next) {
    try {
      const status = await productService.getSemanticSearchStatus();
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  async reindexSemanticSearch(req, res, next) {
    try {
      const status = await productService.reindexSemanticSearch();
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  async createProduct(req, res, next) {
    try {
      const { sellerId, input } = req.body;

      req.log.info({ sellerId, productName: input.name }, 'Creating product');

      const product = await productService.createProduct(sellerId, input, req.correlationId);

      req.log.info({ productId: product._id, sellerId }, 'Product created successfully');

      res.status(201).json(product);
    } catch (error) {
      next(error);
    }
  }

  async updateProduct(req, res, next) {
    try {
      const { id } = req.params;
      const { sellerId, input } = req.body;

      req.log.info({ productId: id, sellerId }, 'Updating product');

      const product = await productService.updateProduct(id, sellerId, input, req.correlationId);

      req.log.info({ productId: id, sellerId }, 'Product updated successfully');

      res.json(product);
    } catch (error) {
      next(error);
    }
  }

  async deleteProduct(req, res, next) {
    try {
      const { id } = req.params;
      const { sellerId } = req.body;

      req.log.info({ productId: id, sellerId }, 'Deleting product');

      await productService.deleteProduct(id, sellerId);

      req.log.info({ productId: id, sellerId }, 'Product deleted successfully');

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  async deductStock(req, res, next) {
    try {
      const { id } = req.params;
      const { variantId, quantity, orderId } = req.body;

      req.log.info({
        productId: id,
        variantId,
        quantity,
        orderId,
      }, 'Deducting stock');

      await productService.deductStock(id, variantId, quantity, orderId, req.correlationId);

      req.log.info({
        productId: id,
        variantId,
        quantity,
        orderId,
      }, 'Stock deducted successfully');

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  async getStock(req, res, next) {
    try {
      const { id } = req.params;
      const { variantId } = req.query;

      const stock = await productService.getProductStock(id, variantId);
      res.json(stock);
    } catch (error) {
      next(error);
    }
  }

  async restoreStock(req, res, next) {
    try {
      const { id } = req.params;
      const { variantId, quantity, orderId } = req.body;

      req.log.info({
        productId: id,
        variantId,
        quantity,
        orderId,
      }, 'Restoring stock');

      await productService.restoreStock(id, variantId, quantity, orderId, req.correlationId);

      req.log.info({
        productId: id,
        variantId,
        quantity,
        orderId,
      }, 'Stock restored successfully');

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProductController();
