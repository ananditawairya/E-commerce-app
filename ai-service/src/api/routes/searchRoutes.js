// backend/ai-service/src/api/routes/searchRoutes.js
// CHANGE: REST API routes for AI search operations

import express from 'express';
import searchController from '../controllers/searchController.js';

const router = express.Router();

// CHANGE: RESTful endpoints for AI search operations
router.post('/semantic', searchController.semanticSearch);
router.post('/index', searchController.indexProducts);
router.get('/index/status', searchController.getIndexStatus);
router.post('/index/:productId', searchController.indexSingleProduct);
router.delete('/index/:productId', searchController.removeProductFromIndex);

export default router;