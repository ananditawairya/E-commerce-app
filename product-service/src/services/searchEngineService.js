const axios = require('axios');

const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.PRODUCT_SEARCH_ENGINE_TIMEOUT_MS || '3000',
  10
);
const DEFAULT_SUGGESTION_LIMIT = Number.parseInt(
  process.env.PRODUCT_SEARCH_SUGGESTION_LIMIT || '8',
  10
);
const MAX_SUGGESTION_LIMIT = 20;

/**
 * Optional dedicated text search integration.
 * Supports Meilisearch for fast suggestions/faceting while preserving
 * MongoDB fallback when disabled or unavailable.
 */
class SearchEngineService {
  constructor() {
    this.enabled = String(
      process.env.PRODUCT_SEARCH_ENGINE_ENABLED || 'false'
    ).toLowerCase() === 'true';
    this.engineType = String(
      process.env.PRODUCT_SEARCH_ENGINE_TYPE || 'meilisearch'
    ).toLowerCase();
    this.meiliHost = process.env.MEILI_HOST || 'http://localhost:7700';
    this.meiliApiKey = process.env.MEILI_MASTER_KEY || '';
    this.meiliIndexName = process.env.MEILI_INDEX_NAME || 'products';

    this.initialized = false;
    this.ready = false;
    this.lastError = null;
  }

  /**
   * Returns whether dedicated search is configured.
   * @return {boolean} True when enabled.
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Returns current runtime mode.
   * @return {string} Search mode.
   */
  getMode() {
    if (!this.enabled) {
      return 'disabled';
    }
    return this.ready ? this.engineType : `${this.engineType}_unavailable`;
  }

  /**
   * Returns search engine status.
   * @return {{enabled: boolean, mode: string, lastError: string|null}} Status snapshot.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      mode: this.getMode(),
      lastError: this.lastError,
    };
  }

  /**
   * Ensures the search engine integration is initialized.
   * @return {Promise<void>} Completion promise.
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!this.enabled) {
      return;
    }

    if (this.engineType !== 'meilisearch') {
      this.lastError = `Unsupported search engine type: ${this.engineType}`;
      this.ready = false;
      console.warn(this.lastError);
      return;
    }

    try {
      await this.ensureMeiliIndex();
      this.ready = true;
      this.lastError = null;
      console.log('✅ Dedicated product search engine is ready (Meilisearch)');
    } catch (error) {
      this.ready = false;
      this.lastError = error.message;
      console.warn(
        '⚠️  Dedicated search engine unavailable, using MongoDB fallback:',
        error.message
      );
    }
  }

  /**
   * Adds/updates one product document in the search index.
   * @param {object} product Product payload.
   * @return {Promise<boolean>} True when indexed.
   */
  async upsertProduct(product) {
    await this.initialize();
    if (!this.ready || !product) {
      return false;
    }

    const document = this.buildDocument(product);
    await this.request('POST', `/indexes/${this.meiliIndexName}/documents`, [document]);
    return true;
  }

  /**
   * Removes one product document from the search index.
   * @param {string} productId Product id.
   * @return {Promise<boolean>} True when removed.
   */
  async deleteProduct(productId) {
    await this.initialize();
    if (!this.ready || !productId) {
      return false;
    }

    await this.request('DELETE', `/indexes/${this.meiliIndexName}/documents/${productId}`);
    return true;
  }

  /**
   * Retrieves search-as-you-type suggestions.
   * @param {{
   *   query: string,
   *   categories?: string[],
   *   limit?: number,
   * }} params Search params.
   * @return {Promise<Array<{text: string, category: string|null, score: number|null, source: string}>>}
   *     Suggestions.
   */
  async searchSuggestions(params) {
    await this.initialize();
    if (!this.ready) {
      return [];
    }

    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (!query) {
      return [];
    }

    const categories = Array.isArray(params.categories)
      ? params.categories
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const safeLimit = Number.isFinite(params.limit)
      ? Math.min(Math.max(params.limit, 1), MAX_SUGGESTION_LIMIT)
      : DEFAULT_SUGGESTION_LIMIT;
    const filter = this.buildFilter(categories);

    const response = await this.request(
      'POST',
      `/indexes/${this.meiliIndexName}/search`,
      {
        q: query,
        limit: safeLimit * 2,
        filter,
        attributesToRetrieve: ['name', 'category'],
      }
    );

    const hits = Array.isArray(response?.hits) ? response.hits : [];
    const uniqueByName = new Map();
    for (const hit of hits) {
      if (!hit || typeof hit.name !== 'string') {
        continue;
      }

      const normalizedName = hit.name.trim();
      if (!normalizedName) {
        continue;
      }

      const dedupeKey = normalizedName.toLowerCase();
      if (!uniqueByName.has(dedupeKey)) {
        uniqueByName.set(dedupeKey, {
          text: normalizedName,
          category: typeof hit.category === 'string' ? hit.category : null,
          score: typeof hit._rankingScore === 'number' ? hit._rankingScore : null,
          source: 'meilisearch',
        });
      }
      if (uniqueByName.size >= safeLimit) {
        break;
      }
    }

    return [...uniqueByName.values()].slice(0, safeLimit);
  }

  /**
   * Ensures Meilisearch index and settings exist.
   * @return {Promise<void>} Completion promise.
   */
  async ensureMeiliIndex() {
    await this.request('GET', '/health');
    try {
      await this.request('POST', '/indexes', {
        uid: this.meiliIndexName,
        primaryKey: 'id',
      });
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode !== 400 && statusCode !== 409) {
        throw error;
      }
    }

    await this.request('PATCH', `/indexes/${this.meiliIndexName}/settings`, {
      searchableAttributes: ['name', 'description', 'category'],
      filterableAttributes: ['category', 'isActive'],
      sortableAttributes: ['basePrice', 'createdAt'],
      typoTolerance: { enabled: true },
    });
  }

  /**
   * Builds index document from product payload.
   * @param {object} product Product payload.
   * @return {object} Search document.
   */
  buildDocument(product) {
    const productId = String(product.id || product._id || '');
    return {
      id: productId,
      name: product.name || '',
      description: product.description || '',
      category: product.category || '',
      basePrice: typeof product.basePrice === 'number' ? product.basePrice : 0,
      isActive: product.isActive !== false,
      createdAt: product.createdAt || new Date().toISOString(),
    };
  }

  /**
   * Builds Meilisearch filter array.
   * @param {string[]} categories Categories filter.
   * @return {string[]} Filter clauses.
   */
  buildFilter(categories) {
    const filters = ['isActive = true'];
    if (Array.isArray(categories) && categories.length > 0) {
      const categoryFilter = categories
        .map((category) => `category = "${String(category).replace(/"/g, '\\"')}"`)
        .join(' OR ');
      filters.push(`(${categoryFilter})`);
    }
    return filters;
  }

  /**
   * Executes one Meilisearch HTTP request.
   * @param {'GET'|'POST'|'PATCH'|'DELETE'} method HTTP method.
   * @param {string} path Request path.
   * @param {object|object[]=} data Optional request body.
   * @return {Promise<object>} Response payload.
   */
  async request(method, path, data) {
    const headers = {};
    if (this.meiliApiKey) {
      headers.Authorization = `Bearer ${this.meiliApiKey}`;
    }

    const response = await axios({
      method,
      url: `${this.meiliHost}${path}`,
      data,
      timeout: DEFAULT_TIMEOUT_MS,
      headers,
    });
    return response.data;
  }
}

module.exports = new SearchEngineService();
