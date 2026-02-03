// backend/ai-service/src/api/controllers/searchController.js
// CHANGE: REST API controller for AI search operations

import searchService from '../../services/searchService.js';

class SearchController {
  async semanticSearch(req, res, next) {
    try {
      const { query, limit = 10, threshold = 0.3 } = req.body;

      req.log.info({ query, limit, threshold }, 'Semantic search request');

      const result = await searchService.performSemanticSearch({
        query,
        limit: parseInt(limit),
        threshold: parseFloat(threshold),
      });

      req.log.info({ 
        query, 
        resultCount: result.count 
      }, 'Semantic search completed');

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async indexProducts(req, res, next) {
    try {
      req.log.info('Product indexing request');

      const result = await searchService.indexAllProducts(req.correlationId);

      req.log.info({ indexed: result.indexed }, 'Product indexing completed');

      res.json({
        success: true,
        ...result,
        message: 'Products indexed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getIndexStatus(req, res, next) {
    try {
      const status = await searchService.getIndexStatus();
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  async indexSingleProduct(req, res, next) {
    try {
      const { productId } = req.params;
      const { productData } = req.body;

      req.log.info({ productId }, 'Single product indexing request');

      const result = await searchService.indexSingleProduct(productId, productData);

      req.log.info({ productId }, 'Single product indexed');

      res.json({
        success: true,
        message: 'Product indexed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async removeProductFromIndex(req, res, next) {
    try {
      const { productId } = req.params;

      req.log.info({ productId }, 'Remove product from index request');

      await searchService.removeProductFromIndex(productId);

      req.log.info({ productId }, 'Product removed from index');

      res.json({
        success: true,
        message: 'Product removed from index',
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new SearchController();