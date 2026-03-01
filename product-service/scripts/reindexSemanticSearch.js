require('dotenv').config();
const mongoose = require('mongoose');

const productSemanticSearchService = require('../src/services/productSemanticSearchService');

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    const result = await productSemanticSearchService.reindexAllActiveProducts();
    console.log('Semantic search reindex result:');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((error) => {
  console.error('Semantic search reindex failed:', error.message);
  process.exit(1);
});

