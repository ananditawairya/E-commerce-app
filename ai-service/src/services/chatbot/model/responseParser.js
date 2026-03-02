/**
 * Extracts JSON payload from model output text.
 * @param {string} rawText Model output.
 * @return {object|null} Parsed JSON payload.
 */
function extractJsonPayload(rawText) {
  if (!rawText) {
    return null;
  }

  const normalized = String(rawText).trim();
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (error) {
      // Continue with fallback parsing.
    }
  }

  try {
    return JSON.parse(normalized);
  } catch (error) {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
    } catch (parseError) {
      return null;
    }
  }
}

/**
 * Parses model response and validates recommendation product ids.
 * @param {{
 *   rawText: string,
 *   candidateProducts: object[],
 *   sanitizeText: (value: unknown) => string,
 *   stripTechnicalIdentifiers: (value: unknown) => string,
 * }} params Parser params.
 * @return {{reply: string, followUpQuestion: string, recommendations: object[]}|null}
 *     Parsed payload.
 */
function parseModelResponse({
  rawText,
  candidateProducts,
  sanitizeText,
  stripTechnicalIdentifiers,
}) {
  const payload = extractJsonPayload(rawText);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidateIdSet = new Set((candidateProducts || []).map((product) => product.id));
  const reply = stripTechnicalIdentifiers(payload.reply || payload.message || '');
  const followUpQuestion = stripTechnicalIdentifiers(payload.followUpQuestion || '');

  const recommendations = Array.isArray(payload.recommendations)
    ? payload.recommendations
      .map((entry) => ({
        productId: sanitizeText(entry?.productId),
        reason: sanitizeText(entry?.reason),
      }))
      .filter((entry) => entry.productId && candidateIdSet.has(entry.productId))
    : [];

  return {
    reply,
    followUpQuestion,
    recommendations,
  };
}

/**
 * Extracts finish reason from generation result.
 * @param {object} generation Generation payload.
 * @return {string} Finish reason.
 */
function getPrimaryFinishReason(generation) {
  const finishReason = generation?.response?.candidates?.[0]?.finishReason;
  return typeof finishReason === 'string' ? finishReason : '';
}

/**
 * Extracts plain text from generation response payload.
 * @param {object} generation Generation payload.
 * @return {string} Model output text.
 */
function extractRawTextFromGeneration(generation) {
  const response = generation?.response;

  try {
    const directText = response?.text?.();
    if (directText) {
      return String(directText);
    }
  } catch (error) {
    // response.text() can throw for blocked/empty candidates.
  }

  const firstCandidateParts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(firstCandidateParts) && firstCandidateParts.length > 0) {
    return firstCandidateParts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  return '';
}

module.exports = {
  extractRawTextFromGeneration,
  getPrimaryFinishReason,
  parseModelResponse,
};
