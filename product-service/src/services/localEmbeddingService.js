const axios = require('axios');

const SEARCH_SEMANTIC_ENABLED = String(process.env.SEARCH_SEMANTIC_ENABLED || 'false').toLowerCase() === 'true';
const SEARCH_EMBEDDING_PROVIDER = (process.env.SEARCH_EMBEDDING_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma';
const OLLAMA_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || '8000', 10);

const sanitizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
};

const normalizeVector = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const cleaned = values.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(cleaned.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return null;
  }

  return cleaned.map((value) => value / magnitude);
};

class LocalEmbeddingService {
  isEnabled() {
    return Boolean(SEARCH_SEMANTIC_ENABLED && SEARCH_EMBEDDING_PROVIDER === 'ollama');
  }

  getModelName() {
    return OLLAMA_EMBED_MODEL;
  }

  async embedText(text) {
    const normalizedText = sanitizeText(text).slice(0, 1200);
    if (!normalizedText || !this.isEnabled()) {
      return null;
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        model: OLLAMA_EMBED_MODEL,
        input: normalizedText,
      },
      {
        timeout: OLLAMA_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const rawVector = Array.isArray(response.data?.embeddings)
      ? response.data.embeddings[0]
      : null;

    return normalizeVector(rawVector);
  }
}

module.exports = new LocalEmbeddingService();

