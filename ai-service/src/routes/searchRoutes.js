// CHANGE: Convert to ES Module syntax
import express from 'express';
import embeddingService from '../services/embeddingService.js';
import productIndexer from '../services/productIndexer.js';

const router = express.Router();

// CHANGE: Semantic search endpoint
router.post('/semantic', async (req, res) => {
  try {
    const { query, limit = 10, threshold = 0.3 } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔍 Semantic search: "${query}"`);

    // CHANGE: Generate embedding for search query
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // CHANGE: Get product index
    const productIndex = await productIndexer.getIndex();

    if (productIndex.length === 0) {
      return res.json({ 
        results: [], 
        message: 'Product index is empty. Please run /api/search/index first.' 
      });
    }

    // CHANGE: Calculate similarity scores
    const scoredProducts = productIndex.map(product => ({
      ...product,
      score: embeddingService.cosineSimilarity(queryEmbedding, product.embedding)
    }));

    // CHANGE: Filter by threshold and sort by score
    const results = scoredProducts
      .filter(p => p.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ embedding, ...product }) => product); // Remove embedding from response

    console.log(`✅ Found ${results.length} results`);

    res.json({ 
      results,
      query,
      count: results.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

// CHANGE: Index products endpoint (run this after adding/updating products)
router.post('/index', async (req, res) => {
  try {
    const result = await productIndexer.indexProducts();
    res.json({ 
      success: true, 
      ...result,
      message: 'Products indexed successfully'
    });
  } catch (error) {
    console.error('Indexing error:', error);
    res.status(500).json({ error: 'Indexing failed', message: error.message });
  }
});

// CHANGE: Get index status
router.get('/index/status', async (req, res) => {
  try {
    const index = await productIndexer.getIndex();
    res.json({ 
      indexed: index.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get index status' });
  }
});

// CHANGE: Export as default for ES Module
export default router;