// ai-service/scripts/reindexSemanticCatalog.js
// Force rebuild semantic index and print status.

require('dotenv').config();

const cacheService = require('../src/services/cacheService');
const semanticSearchService = require('../src/services/semanticSearchService');

const main = async () => {
    const reason = process.env.AI_SEMANTIC_REINDEX_REASON || 'manual_script';

    await cacheService.connect();

    try {
        const status = await semanticSearchService.forceReindex(reason);

        console.log('Semantic reindex status:');
        console.log(JSON.stringify(status, null, 2));

        if (!status.enabled) {
            process.exitCode = 1;
        }
    } finally {
        await cacheService.disconnect();
    }
};

main().catch((error) => {
    console.error('Semantic reindex failed:', error.message);
    process.exit(1);
});
