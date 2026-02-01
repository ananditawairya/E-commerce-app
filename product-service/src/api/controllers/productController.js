// backend/product-service/src/api/controllers/productController.js
// CHANGE: Pass correlation ID to service layer for Kafka events

const productService = require('../../services/productService');

class ProductController {
  async getProducts(req, res, next) {
    try {
      const { search, category, limit, offset } = req.query;
      const products = await productService.getProducts({
        search,
        category,
        limit: limit ? parseInt(limit) : 20,
        offset: offset ? parseInt(offset) : 0,
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

  async createProduct(req, res, next) {
    try {
      const { sellerId, input } = req.body;

      req.log.info({ sellerId, productName: input.name }, 'Creating product');

      // CHANGE: Pass correlation ID to service for Kafka event
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

      // CHANGE: Pass correlation ID to service for Kafka event
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

      // CHANGE: Pass correlation ID to service for Kafka event
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

  // CHANGE: Add restore stock controller method for order cancellations
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