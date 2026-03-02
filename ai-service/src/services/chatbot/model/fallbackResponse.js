/**
 * Builds fallback assistant response when model output is unavailable.
 * @param {{
 *   candidateProducts: object[],
 *   slots: object,
 *   getTotalStock: (product: object) => number,
 *   formatMoney: (value: unknown) => string,
 * }} params Fallback params.
 * @return {{reply: string, followUpQuestion: string}} Fallback response.
 */
function buildFallbackAssistantMessage({
  candidateProducts,
  slots,
  getTotalStock,
  formatMoney,
}) {
  if (!candidateProducts || candidateProducts.length === 0) {
    return {
      reply: 'I can help with that. Share your preferred category, budget range, and style so I can narrow the best options.',
      followUpQuestion: 'What is your budget and preferred category?',
    };
  }

  const options = candidateProducts.slice(0, 3).map((product) => {
    const stock = getTotalStock(product);
    return `- ${product.name}: ${formatMoney(product.basePrice)} (${stock > 0 ? `${stock} in stock` : 'out of stock'})`;
  }).join('\n');

  const budgetLine = typeof slots?.maxPrice === 'number'
    ? ` under ${formatMoney(slots.maxPrice)}`
    : '';

  return {
    reply: `Here are strong matches${budgetLine}:\n${options}`,
    followUpQuestion: 'Do you want me to optimize for lowest price, premium quality, or fastest delivery?',
  };
}

/**
 * Ensures final assistant message always has user-facing content.
 * @param {{
 *   reply: string,
 *   candidateProducts: object[],
 *   slots: object,
 *   normalizeMultiLineText: (value: unknown) => string,
 *   stripTechnicalIdentifiers: (value: unknown) => string,
 *   buildFallback: (params: object) => {reply: string},
 * }} params Message params.
 * @return {string} Final message text.
 */
function ensureFinalMessage({
  reply,
  candidateProducts,
  slots,
  normalizeMultiLineText,
  stripTechnicalIdentifiers,
  buildFallback,
}) {
  const cleanReply = stripTechnicalIdentifiers(reply || '');
  if (cleanReply) {
    return normalizeMultiLineText(cleanReply);
  }

  const fallback = buildFallback({ candidateProducts, slots });
  return normalizeMultiLineText(fallback.reply);
}

module.exports = {
  buildFallbackAssistantMessage,
  ensureFinalMessage,
};
