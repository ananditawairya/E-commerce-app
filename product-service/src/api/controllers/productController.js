// backend/product-service/src/api/controllers/productController.js
// CHANGE: REST API controller for product operations

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
      
      // CHANGE: Audit log
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

      // CHANGE: Audit log
      req.log.info({ sellerId, productName: input.name }, 'Creating product');

      const product = await productService.createProduct(sellerId, input);

      // CHANGE: Audit log success
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

      // CHANGE: Audit log
      req.log.info({ productId: id, sellerId }, 'Updating product');

      const product = await productService.updateProduct(id, sellerId, input);

      // CHANGE: Audit log success
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

      // CHANGE: Audit log
      req.log.info({ productId: id, sellerId }, 'Deleting product');

      await productService.deleteProduct(id, sellerId);

      // CHANGE: Audit log success
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

      // CHANGE: Audit log with order traceability
      req.log.info({
        productId: id,
        variantId,
        quantity,
        orderId,
      }, 'Deducting stock');

      await productService.deductStock(id, variantId, quantity);

      // CHANGE: Audit log success
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
}

module.exports = new ProductController();