const {
  EMBEDDING_API_VERSION,
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_CANDIDATES,
  SEMANTIC_ENABLED,
} = require('./config');

/**
 * Determines whether semantic search is currently enabled.
 * @param {object} service SemanticSearchService instance.
 * @return {boolean} True when semantic search is enabled.
 */
function isEnabled(service) {
  return Boolean(SEMANTIC_ENABLED && service.genAI);
}

/**
 * Returns semantic search public status snapshot.
 * @param {object} service SemanticSearchService instance.
 * @return {object} Status payload.
 */
function getPublicStatus(service) {
  return {
    enabled: isEnabled(service),
    indexSize: service.index.products.length,
    updatedAt: service.index.updatedAt ? new Date(service.index.updatedAt).toISOString() : null,
    building: Boolean(service.indexBuildPromise),
    source: service.index.source,
    stats: service.index.stats,
    lastError: service.lastError,
    model: service.embeddingModelName || EMBEDDING_MODEL || null,
    modelCandidates: EMBEDDING_MODEL_CANDIDATES,
    apiVersion: EMBEDDING_API_VERSION,
  };
}

/**
 * Resolves active embedding model instance.
 * @param {object} service SemanticSearchService instance.
 * @return {object|null} Active embedding model.
 */
function getEmbeddingModel(service) {
  if (!isEnabled(service) || service.embeddingModelsExhausted) {
    return null;
  }

  if (!service.embeddingModel || !service.embeddingModelName) {
    const nextModelName = EMBEDDING_MODEL_CANDIDATES.find(
      (modelName) => !service.failedEmbeddingModels.has(modelName)
    );

    if (!nextModelName) {
      service.embeddingModelsExhausted = true;
      return null;
    }

    service.embeddingModelName = nextModelName;
    service.embeddingModel = service.genAI.getGenerativeModel({
      model: nextModelName,
    }, {
      apiVersion: EMBEDDING_API_VERSION,
    });
  }

  return service.embeddingModel;
}

/**
 * Marks current embedding model as unavailable and rotates to next candidate.
 * @param {object} service SemanticSearchService instance.
 * @param {string} modelName Failed model name.
 * @param {Error} error Failure error.
 * @return {void} No return value.
 */
function markEmbeddingModelUnavailable(service, modelName, error) {
  if (modelName) {
    service.failedEmbeddingModels.add(modelName);
  }

  service.embeddingModel = null;
  service.embeddingModelName = null;

  if (service.failedEmbeddingModels.size >= EMBEDDING_MODEL_CANDIDATES.length) {
    service.embeddingModelsExhausted = true;
    service.lastError = {
      message: 'No supported embedding model configured',
      at: new Date().toISOString(),
      reason: 'embedding_model_unavailable',
      triedModels: EMBEDDING_MODEL_CANDIDATES,
    };
    return;
  }

  console.warn(
    `Embedding model "${modelName}" unavailable (${error?.message || 'unknown error'}). Trying fallback model...`
  );
}

module.exports = {
  getEmbeddingModel,
  getPublicStatus,
  isEnabled,
  markEmbeddingModelUnavailable,
};
