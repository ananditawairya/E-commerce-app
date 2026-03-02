require('dotenv').config();
const mongoose = require('mongoose');

const Product = require('../src/models/Product');
const searchEngineService = require('../src/services/searchEngineService');

/**
 * Reindexes active products into the dedicated search engine.
 * @return {Promise<void>} Completion promise.
 */
const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await searchEngineService.initialize();
    const status = searchEngineService.getStatus();

    if (!status.enabled) {
      console.log('Dedicated search engine is disabled. Skipping reindex.');
      return;
    }

    if (!status.mode || status.mode.endsWith('_unavailable')) {
      throw new Error(
        `Dedicated search engine not ready: ${status.mode || 'unknown'}${status.lastError ? ` (${status.lastError})` : ''}`
      );
    }

    const products = await Product.find({ isActive: true })
      .select('_id name description category basePrice isActive createdAt updatedAt')
      .lean();

    let indexed = 0;
    let failed = 0;

    for (const product of products) {
      try {
        const success = await searchEngineService.upsertProduct({
          ...product,
          id: String(product._id),
        });
        if (success) {
          indexed += 1;
        }
      } catch (error) {
        failed += 1;
        if (failed <= 5) {
          console.error(
            `Search reindex failed for product ${String(product._id)}: ${error.message}`
          );
        }
      }
    }

    const result = {
      enabled: status.enabled,
      mode: searchEngineService.getMode(),
      totalProducts: products.length,
      indexed,
      failed,
    };

    console.log('Dedicated search reindex result:');
    console.log(JSON.stringify(result, null, 2));

    if (failed > 0) {
      throw new Error(`Search reindex completed with ${failed} failures`);
    }
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((error) => {
  console.error('Dedicated search reindex failed:', error.message);
  process.exit(1);
});
