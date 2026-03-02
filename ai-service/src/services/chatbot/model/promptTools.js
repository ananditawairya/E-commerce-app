/**
 * Builds system prompt for strict structured model output.
 * @return {string} System prompt text.
 */
function buildStructuredSystemPrompt() {
  return `You are an AI shopping assistant for an e-commerce app.

You must return STRICT JSON with this exact structure:
{
  "reply": "string",
  "recommendations": [
    {
      "productId": "string",
      "reason": "string"
    }
  ],
  "followUpQuestion": "string"
}

Rules:
1. Use ONLY candidate products provided in the input payload.
2. Never expose internal IDs in reply text.
3. Keep reply concise, practical, and under 120 words.
4. Return 0-4 recommendations.
5. If intent is unclear, ask one short follow-up question.
6. Never include markdown fences or additional keys.
7. Ensure the JSON is complete and valid (no trailing commas, no partial output).`;
}

/**
 * Builds prompt payload sent to model generation.
 * @param {{
 *   message: string,
 *   conversation: object,
 *   slots: object,
 *   candidates: object[],
 *   maxHistoryTurns: number,
 *   sanitizeText: (value: unknown) => string,
 *   buildCandidateContext: (products: object[]) => object[],
 * }} params Prompt params.
 * @return {object} Prompt payload.
 */
function buildPromptPayload({
  message,
  conversation,
  slots,
  candidates,
  maxHistoryTurns,
  sanitizeText,
  buildCandidateContext,
}) {
  const recentHistory = (conversation.messages || [])
    .slice(-maxHistoryTurns * 2)
    .map((entry) => ({
      role: entry.role,
      text: sanitizeText(entry.parts?.[0]?.text || ''),
    }))
    .filter((entry) => entry.text)
    .slice(-maxHistoryTurns * 2);

  return {
    userMessage: sanitizeText(message),
    preferenceSlots: {
      category: slots.category,
      minPrice: slots.minPrice,
      maxPrice: slots.maxPrice,
      inStockOnly: slots.inStockOnly,
      sortBy: slots.sortBy,
      styleKeywords: slots.styleKeywords,
    },
    recentHistory,
    candidates: buildCandidateContext(candidates),
  };
}

module.exports = {
  buildPromptPayload,
  buildStructuredSystemPrompt,
};
