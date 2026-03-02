const { buildStructuredSystemPrompt } = require('./promptTools');
const {
  extractRawTextFromGeneration,
  getPrimaryFinishReason,
} = require('./responseParser');

/**
 * Creates one configured chat model instance.
 * @param {{
 *   genAI: object,
 *   modelName: string,
 *   chatResponseSchema: object,
 *   modelMaxOutputTokens: number,
 *   temperature?: number,
 *   maxOutputTokens?: number,
 * }} params Model options.
 * @return {object} Chat model.
 */
function createChatModel({
  genAI,
  modelName,
  chatResponseSchema,
  modelMaxOutputTokens,
  temperature = 0.3,
  maxOutputTokens = modelMaxOutputTokens,
}) {
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildStructuredSystemPrompt(),
    generationConfig: {
      temperature,
      topP: 0.9,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: chatResponseSchema,
    },
  });
}

/**
 * Runs one structured model generation attempt with timeout.
 * @param {{
 *   genAI: object,
 *   modelName: string,
 *   chatResponseSchema: object,
 *   modelMaxOutputTokens: number,
 *   modelTimeoutMs: number,
 *   withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => Promise<T>,
 *   promptPayload: object,
 *   temperature?: number,
 *   maxOutputTokens?: number,
 *   timeoutMessage?: string,
 * }} params Generation params.
 * @return {Promise<{rawText: string, finishReason: string}>} Generation result.
 */
async function runStructuredGeneration({
  genAI,
  modelName,
  chatResponseSchema,
  modelMaxOutputTokens,
  modelTimeoutMs,
  withTimeout,
  promptPayload,
  temperature = 0.3,
  maxOutputTokens = modelMaxOutputTokens,
  timeoutMessage = 'AI model timeout',
}) {
  const model = createChatModel({
    genAI,
    modelName,
    chatResponseSchema,
    modelMaxOutputTokens,
    temperature,
    maxOutputTokens,
  });

  const generation = await withTimeout(
    model.generateContent(JSON.stringify(promptPayload)),
    modelTimeoutMs,
    timeoutMessage
  );

  return {
    rawText: extractRawTextFromGeneration(generation),
    finishReason: getPrimaryFinishReason(generation),
  };
}

module.exports = {
  runStructuredGeneration,
};
