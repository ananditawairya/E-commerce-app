const { buildPromptPayload } = require('./model/promptTools');
const { parseModelResponse } = require('./model/responseParser');
const {
  buildFallbackAssistantMessage,
  ensureFinalMessage: ensureFinalMessageWithFallback,
} = require('./model/fallbackResponse');
const { runStructuredGeneration } = require('./model/generationRunner');

/**
 * Creates model generation helpers for chatbot replies.
 * @param {{
 *   genAI: object,
 *   config: {
 *     chatResponseSchema: object,
 *     modelMaxOutputTokens: number,
 *     modelName: string,
 *     modelRetryMaxOutputTokens: number,
 *     modelTimeoutMs: number,
 *   },
 *   tools: {
 *     buildCandidateContext: (products: object[]) => object[],
 *     formatMoney: (value: unknown) => string,
 *     getTotalStock: (product: object) => number,
 *     normalizeMultiLineText: (value: unknown) => string,
 *     sanitizeText: (value: unknown) => string,
 *     stripTechnicalIdentifiers: (value: unknown) => string,
 *     withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => Promise<T>,
 *   },
 *   maxHistoryTurns: number,
 * }} deps Model dependencies.
 * @return {{
 *   generateAssistantResponse: (params: {message: string, conversation: object, slots: object, candidateProducts: object[]}) => Promise<{reply: string, followUpQuestion: string, recommendations?: object[]}>,
 *   ensureFinalMessage: (reply: string, followUpQuestion: string, candidateProducts: object[], slots: object) => string,
 * }} Model response helpers.
 */
function createModelResponseTools(deps) {
  const {
    genAI,
    config,
    tools,
    maxHistoryTurns,
  } = deps;

  const {
    chatResponseSchema,
    modelMaxOutputTokens,
    modelName,
    modelRetryMaxOutputTokens,
    modelTimeoutMs,
  } = config;

  const {
    buildCandidateContext,
    formatMoney,
    getTotalStock,
    normalizeMultiLineText,
    sanitizeText,
    stripTechnicalIdentifiers,
    withTimeout,
  } = tools;

  /**
   * Builds fallback assistant message from candidate products.
   * @param {object[]} candidateProducts Candidate products.
   * @param {object} slots Preference slots.
   * @return {{reply: string, followUpQuestion: string}} Fallback response.
   */
  function buildFallback(candidateProducts, slots) {
    return buildFallbackAssistantMessage({
      candidateProducts,
      slots,
      getTotalStock,
      formatMoney,
    });
  }

  /**
   * Generates assistant response using model with retry/fallback.
   * @param {{message: string, conversation: object, slots: object, candidateProducts: object[]}} params Generation inputs.
   * @return {Promise<{reply: string, followUpQuestion: string, recommendations: object[]}>}
   *     Assistant response.
   */
  async function generateAssistantResponse({ message, conversation, slots, candidateProducts }) {
    if (!process.env.GEMINI_API_KEY || !genAI) {
      return buildFallback(candidateProducts, slots);
    }

    try {
      const promptPayload = buildPromptPayload({
        message,
        conversation,
        slots,
        candidates: candidateProducts,
        maxHistoryTurns,
        sanitizeText,
        buildCandidateContext,
      });

      let rawText = '';
      let finishReason = '';
      let parsed = null;

      try {
        const attemptOne = await runStructuredGeneration({
          genAI,
          modelName,
          chatResponseSchema,
          modelMaxOutputTokens,
          modelTimeoutMs,
          withTimeout,
          promptPayload,
          temperature: 0.3,
          maxOutputTokens: modelMaxOutputTokens,
          timeoutMessage: 'AI model timeout',
        });
        rawText = attemptOne.rawText;
        finishReason = attemptOne.finishReason;
        parsed = parseModelResponse({
          rawText,
          candidateProducts,
          sanitizeText,
          stripTechnicalIdentifiers,
        });
      } catch (attemptOneError) {
        console.warn('AI model first attempt failed:', attemptOneError.message);
      }

      const shouldRetry = !parsed || !rawText || finishReason === 'MAX_TOKENS';
      if (shouldRetry) {
        try {
          const attemptTwo = await runStructuredGeneration({
            genAI,
            modelName,
            chatResponseSchema,
            modelMaxOutputTokens,
            modelTimeoutMs,
            withTimeout,
            promptPayload,
            temperature: 0.2,
            maxOutputTokens: Math.max(modelRetryMaxOutputTokens, modelMaxOutputTokens),
            timeoutMessage: 'AI model retry timeout',
          });

          rawText = attemptTwo.rawText || rawText;
          finishReason = attemptTwo.finishReason || finishReason;
          parsed = parseModelResponse({
            rawText,
            candidateProducts,
            sanitizeText,
            stripTechnicalIdentifiers,
          }) || parsed;
        } catch (retryError) {
          console.warn('AI model retry also failed:', retryError.message);
        }
      }

      if (!parsed || (!parsed.reply && parsed.recommendations.length === 0)) {
        if (!parsed) {
          console.warn(
            `AI response parse failed (model=${modelName}, finishReason=${finishReason || 'unknown'}); falling back. Raw length=${String(rawText).length}, preview:`,
            String(rawText || '').slice(0, 300)
          );
        } else {
          console.warn(
            `AI response missing reply and recommendations (model=${modelName}); falling back.`
          );
        }
        return {
          ...buildFallback(candidateProducts, slots),
          recommendations: [],
        };
      }

      if (!parsed.reply && parsed.recommendations.length > 0) {
        return {
          reply: 'I found a few relevant options. Tell me your budget and preferred style so I can narrow these down.',
          followUpQuestion: parsed.followUpQuestion,
          recommendations: parsed.recommendations,
        };
      }

      return {
        reply: parsed.reply,
        followUpQuestion: parsed.followUpQuestion,
        recommendations: parsed.recommendations,
      };
    } catch (error) {
      console.warn(
        `AI generation failed (model=${modelName}, timeoutMs=${modelTimeoutMs}), using fallback response:`,
        error.message
      );
      return {
        ...buildFallback(candidateProducts, slots),
        recommendations: [],
      };
    }
  }

  /**
   * Ensures final assistant message always has user-facing content.
   * @param {string} reply Model reply.
   * @param {string} followUpQuestion Follow-up text.
   * @param {object[]} candidateProducts Candidate products.
   * @param {object} slots Preference slots.
   * @return {string} Final message text.
   */
  function ensureFinalMessage(reply, followUpQuestion, candidateProducts, slots) {
    void followUpQuestion;
    return ensureFinalMessageWithFallback({
      reply,
      candidateProducts,
      slots,
      normalizeMultiLineText,
      stripTechnicalIdentifiers,
      buildFallback: ({ candidateProducts: products, slots: slotValues }) =>
        buildFallback(products, slotValues),
    });
  }

  return {
    ensureFinalMessage,
    generateAssistantResponse,
  };
}

module.exports = {
  createModelResponseTools,
};
