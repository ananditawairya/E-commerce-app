const {
  BLOCKED_PATTERNS,
  LOW_INTENT_MESSAGES,
  MIN_GAP_BETWEEN_MESSAGES_MS,
  PROMPT_ATTACK_PATTERNS,
} = require('./config');
const { sanitizeText } = require('./textUtils');
const { extractKeywordTokens } = require('./preferences');

/**
 * Validates user input for safety and prompt-injection patterns.
 * @param {string} message User message.
 * @return {{blocked: boolean, reason: string|null, safeMessage: string|null}} Safety result.
 */
function validateMessageSafety(message) {
  const cleanMessage = sanitizeText(message);

  if (!cleanMessage) {
    return {
      blocked: true,
      reason: 'empty',
      safeMessage: 'Please share what product you are looking for, and I will help right away.',
    };
  }

  if (cleanMessage.length > 500) {
    return {
      blocked: true,
      reason: 'too_long',
      safeMessage: 'That message is a bit long. Please send a shorter request with your category and budget.',
    };
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(cleanMessage))) {
    return {
      blocked: true,
      reason: 'unsafe_content',
      safeMessage: 'I can only assist with shopping-related requests. Ask me about products, budget, or recommendations.',
    };
  }

  if (PROMPT_ATTACK_PATTERNS.some((pattern) => pattern.test(cleanMessage))) {
    return {
      blocked: true,
      reason: 'prompt_attack',
      safeMessage: 'I can help with shopping recommendations. Tell me what you want to buy and your budget.',
    };
  }

  return {
    blocked: false,
    reason: null,
    safeMessage: null,
  };
}

/**
 * Detects low-intent conversational messages.
 * @param {string} message User message.
 * @return {boolean} True when user intent is too weak for retrieval.
 */
function isLowIntentMessage(message) {
  const clean = sanitizeText(message).toLowerCase();
  if (!clean) {
    return true;
  }

  if (LOW_INTENT_MESSAGES.has(clean)) {
    return true;
  }

  const keywords = extractKeywordTokens(clean, 8);
  return keywords.length === 0;
}

/**
 * Guards against duplicate rapid-fire user messages.
 * @param {{messages: object[], lastUserMessageAt: number}} conversation Conversation state.
 * @param {string} cleanMessage Sanitized user message.
 * @return {{message: string}|null} Guard message when throttled.
 */
function enforceRapidMessageGuard(conversation, cleanMessage) {
  const now = Date.now();
  const tooFast = now - (conversation.lastUserMessageAt || 0) < MIN_GAP_BETWEEN_MESSAGES_MS;

  if (!tooFast) {
    conversation.lastUserMessageAt = now;
    return null;
  }

  const recentUserMessage = [...conversation.messages]
    .reverse()
    .find((entry) => entry.role === 'user')?.parts?.[0]?.text;

  const isDuplicate = sanitizeText(recentUserMessage).toLowerCase() === cleanMessage.toLowerCase();
  conversation.lastUserMessageAt = now;

  if (!isDuplicate) {
    return null;
  }

  return {
    message: 'I am still processing your previous request. Give me a second and ask again if needed.',
  };
}

module.exports = {
  enforceRapidMessageGuard,
  isLowIntentMessage,
  validateMessageSafety,
};
