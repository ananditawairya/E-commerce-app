// ai-service/scripts/evaluateChat.js
// Quick evaluation harness for chat quality and latency.

const axios = require('axios');

const GRAPHQL_URL = process.env.AI_EVAL_GRAPHQL_URL || 'http://localhost:4004/graphql';
const EVAL_USER_ID = process.env.AI_EVAL_USER_ID || `eval-user-${Date.now()}`;
const LATENCY_TARGET_MS = Number.parseInt(process.env.AI_EVAL_LATENCY_TARGET_MS || '2500', 10);

const TEST_CASES = [
    {
        id: 'budget_pet',
        prompt: 'Suggest in-stock pet supplies under $40',
    },
    {
        id: 'office_value',
        prompt: 'I need ergonomic office items around 100 dollars',
    },
    {
        id: 'generic_followup',
        prompt: 'Suggest something stylish',
    },
    {
        id: 'price_sort',
        prompt: 'Show cheapest sports products below $80',
    },
    {
        id: 'category_specific',
        prompt: 'I want stationery for college, in stock only',
    },
];

const MUTATION = `
  mutation SendChatMessage($userId: ID!, $message: String!, $conversationId: String) {
    sendChatMessage(userId: $userId, message: $message, conversationId: $conversationId) {
      message
      conversationId
      latencyMs
      cacheHit
      safetyBlocked
      semanticUsed
      followUpQuestion
      appliedFilters
      products {
        id
        name
        basePrice
      }
    }
  }
`;

const hasLeakedTechnicalId = (text) => {
    const value = String(text || '');
    if (/\bID:\s*[A-Za-z0-9-]+/i.test(value)) {
        return true;
    }

    return /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value);
};

const run = async () => {
    const results = [];
    let conversationId = null;

    for (const testCase of TEST_CASES) {
        const startedAt = Date.now();

        try {
            const response = await axios.post(
                GRAPHQL_URL,
                {
                    query: MUTATION,
                    variables: {
                        userId: EVAL_USER_ID,
                        message: testCase.prompt,
                        conversationId,
                    },
                },
                {
                    timeout: 12000,
                }
            );

            const payload = response.data?.data?.sendChatMessage;
            conversationId = payload?.conversationId || conversationId;

            const elapsedMs = Date.now() - startedAt;
            const message = payload?.message || '';
            const products = Array.isArray(payload?.products) ? payload.products : [];
            const leakedId = hasLeakedTechnicalId(message);
            const passed = Boolean(message) && !leakedId;

            results.push({
                id: testCase.id,
                prompt: testCase.prompt,
                elapsedMs,
                modelLatencyMs: payload?.latencyMs ?? null,
                cacheHit: Boolean(payload?.cacheHit),
                semanticUsed: Boolean(payload?.semanticUsed),
                productsReturned: products.length,
                leakedTechnicalId: leakedId,
                messageLength: message.length,
                passed,
            });
        } catch (error) {
            results.push({
                id: testCase.id,
                prompt: testCase.prompt,
                elapsedMs: Date.now() - startedAt,
                modelLatencyMs: null,
                cacheHit: false,
                semanticUsed: false,
                productsReturned: 0,
                leakedTechnicalId: false,
                messageLength: 0,
                passed: false,
                error: error.response?.data || error.message,
            });
        }
    }

    const passCount = results.filter((result) => result.passed).length;
    const averageLatency = Math.round(
        results.reduce((sum, result) => sum + (result.elapsedMs || 0), 0) / Math.max(results.length, 1)
    );

    console.log('\nAI Chat Evaluation Results\n');
    console.table(results.map((result) => ({
        case: result.id,
        elapsedMs: result.elapsedMs,
        modelLatencyMs: result.modelLatencyMs,
        cacheHit: result.cacheHit,
        semanticUsed: result.semanticUsed,
        products: result.productsReturned,
        leakedId: result.leakedTechnicalId,
        passed: result.passed,
    })));

    console.log(`Pass rate: ${passCount}/${results.length}`);
    console.log(`Average latency: ${averageLatency}ms (target <= ${LATENCY_TARGET_MS}ms)`);

    const latencyPass = averageLatency <= LATENCY_TARGET_MS;
    const qualityPass = passCount === results.length;

    if (!latencyPass || !qualityPass) {
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error('Evaluation failed:', error.message);
    process.exit(1);
});
