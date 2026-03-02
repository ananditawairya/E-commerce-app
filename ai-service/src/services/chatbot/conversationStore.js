/**
 * Creates in-memory + cache-backed conversation store for chatbot sessions.
 * @param {{
 *   cacheService: object,
 *   conversationCacheTtlMs: number,
 *   maxConversationMemory: number,
 *   createDefaultPreferenceSlots: () => object,
 *   mergePreferenceSlots: (previousSlots: object, newSlots: object) => object,
 * }} deps Store dependencies.
 * @return {{
 *   loadConversation: (conversationId: string, userId: string) => Promise<object>,
 *   persistConversation: (conversation: object) => Promise<void>,
 *   cleanupConversations: () => void,
 *   getConversation: (conversationId: string) => Promise<object|null>,
 *   clearConversation: (conversationId: string) => Promise<boolean>,
 * }} Conversation store API.
 */
function createConversationStore(deps) {
  const {
    cacheService,
    conversationCacheTtlMs,
    maxConversationMemory,
    createDefaultPreferenceSlots,
    mergePreferenceSlots,
  } = deps;

  const conversations = new Map();

  /**
   * Builds cache key for one conversation.
   * @param {string} conversationId Conversation id.
   * @return {string} Cache key.
   */
  function buildConversationCacheKey(conversationId) {
    return `ai:chat:conversation:${conversationId}`;
  }

  /**
   * Deserializes cached conversation payload.
   * @param {object} rawConversation Cached payload.
   * @param {string} conversationId Conversation id.
   * @param {string} userId User id.
   * @return {object} Normalized conversation state.
   */
  function deserializeConversation(rawConversation, conversationId, userId) {
    const base = {
      id: conversationId,
      userId,
      messages: [],
      lastRetrievedProducts: [],
      preferenceSlots: createDefaultPreferenceSlots(),
      lastUserMessageAt: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (!rawConversation || typeof rawConversation !== 'object') {
      return base;
    }

    return {
      ...base,
      ...rawConversation,
      id: conversationId,
      userId,
      messages: Array.isArray(rawConversation.messages) ? rawConversation.messages : [],
      lastRetrievedProducts: Array.isArray(rawConversation.lastRetrievedProducts)
        ? rawConversation.lastRetrievedProducts
        : [],
      preferenceSlots: mergePreferenceSlots(
        createDefaultPreferenceSlots(),
        rawConversation.preferenceSlots || {}
      ),
      lastUserMessageAt: Number.parseInt(rawConversation.lastUserMessageAt || '0', 10) || 0,
      createdAt: rawConversation.createdAt ? new Date(rawConversation.createdAt) : new Date(),
      updatedAt: rawConversation.updatedAt ? new Date(rawConversation.updatedAt) : new Date(),
    };
  }

  /**
   * Loads a conversation from memory or cache.
   * @param {string} conversationId Conversation id.
   * @param {string} userId User id.
   * @return {Promise<object>} Conversation state.
   */
  async function loadConversation(conversationId, userId) {
    if (conversations.has(conversationId)) {
      return conversations.get(conversationId);
    }

    const cachedConversation = await cacheService.getJson(buildConversationCacheKey(conversationId));
    const conversation = deserializeConversation(cachedConversation, conversationId, userId);
    conversations.set(conversationId, conversation);

    return conversation;
  }

  /**
   * Persists conversation to memory and cache.
   * @param {object} conversation Conversation state.
   * @return {Promise<void>} No return value.
   */
  async function persistConversation(conversation) {
    conversations.set(conversation.id, conversation);
    await cacheService.setJson(
      buildConversationCacheKey(conversation.id),
      {
        ...conversation,
        createdAt: conversation.createdAt?.toISOString?.() || new Date().toISOString(),
        updatedAt: conversation.updatedAt?.toISOString?.() || new Date().toISOString(),
      },
      conversationCacheTtlMs
    );
  }

  /**
   * Removes oldest in-memory conversation when limit is reached.
   * @return {void} No return value.
   */
  function cleanupConversations() {
    if (conversations.size <= maxConversationMemory) {
      return;
    }

    const oldest = [...conversations.entries()]
      .sort((a, b) => {
        const aTime = new Date(a[1]?.updatedAt || a[1]?.createdAt || 0).getTime();
        const bTime = new Date(b[1]?.updatedAt || b[1]?.createdAt || 0).getTime();
        return aTime - bTime;
      })[0];

    if (oldest) {
      conversations.delete(oldest[0]);
    }
  }

  /**
   * Loads conversation by id without user-id context.
   * @param {string} conversationId Conversation id.
   * @return {Promise<object|null>} Conversation payload.
   */
  async function getConversation(conversationId) {
    if (!conversationId) {
      return null;
    }

    if (conversations.has(conversationId)) {
      return conversations.get(conversationId);
    }

    const cached = await cacheService.getJson(buildConversationCacheKey(conversationId));
    if (!cached) {
      return null;
    }

    const conversation = deserializeConversation(cached, conversationId, cached.userId || 'unknown');
    conversations.set(conversationId, conversation);
    return conversation;
  }

  /**
   * Clears conversation from memory and cache.
   * @param {string} conversationId Conversation id.
   * @return {Promise<boolean>} True when cleared.
   */
  async function clearConversation(conversationId) {
    conversations.delete(conversationId);
    await cacheService.delete(buildConversationCacheKey(conversationId));
    return true;
  }

  return {
    clearConversation,
    cleanupConversations,
    getConversation,
    loadConversation,
    persistConversation,
  };
}

module.exports = {
  createConversationStore,
};
