const { clamp, toFiniteNumber } = require('./queryUtils');

/**
 * Extracts product identifier.
 * @param {object} product Product payload.
 * @return {string|null} Product id.
 */
function getProductId(product) {
  if (!product || typeof product !== 'object') {
    return null;
  }

  const candidate = product.id || product._id;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate;
  }

  if (typeof candidate === 'number') {
    return String(candidate);
  }

  return null;
}

/**
 * Computes total in-stock quantity.
 * @param {object} product Product payload.
 * @return {number} Total stock.
 */
function getTotalStock(product) {
  if (!Array.isArray(product?.variants)) {
    return 0;
  }

  return product.variants.reduce((sum, variant) => (
    sum + Math.max(0, toFiniteNumber(variant?.stock, 0))
  ), 0);
}

/**
 * Derives sales and CTR signals from product payload.
 * @param {object} product Product payload.
 * @return {{sales: number, ctr: number}} Sales and ctr raw values.
 */
function getSalesAndCtr(product) {
  const sales = Math.max(
    0,
    toFiniteNumber(
      product?.salesCount,
      toFiniteNumber(
        product?.purchaseCount,
        toFiniteNumber(product?.totalSold, 0)
      )
    )
  );
  const explicitCtr = toFiniteNumber(product?.ctr, NaN);
  if (Number.isFinite(explicitCtr)) {
    return {
      sales,
      ctr: Math.max(0, explicitCtr),
    };
  }

  const viewCount = Math.max(
    0,
    toFiniteNumber(product?.viewCount, toFiniteNumber(product?.impressions, 0))
  );
  const ctr = viewCount > 0 ? sales / viewCount : 0;
  return {
    sales,
    ctr: Math.max(0, ctr),
  };
}

/**
 * Builds normalized signal maps for hybrid ranking.
 * @param {Array<{product: object, lexicalScore: number, semanticScore: number}>} entries
 *     Candidate entries.
 * @return {{
 *   lexicalMax: number,
 *   stockMax: number,
 *   salesMax: number,
 *   ctrMax: number,
 * }} Max values for normalization.
 */
function getSignalMaxValues(entries) {
  let lexicalMax = 0;
  let stockMax = 0;
  let salesMax = 0;
  let ctrMax = 0;

  entries.forEach((entry) => {
    lexicalMax = Math.max(lexicalMax, Math.max(0, toFiniteNumber(entry.lexicalScore, 0)));
    stockMax = Math.max(stockMax, getTotalStock(entry.product));
    const { sales, ctr } = getSalesAndCtr(entry.product);
    salesMax = Math.max(salesMax, sales);
    ctrMax = Math.max(ctrMax, ctr);
  });

  return {
    lexicalMax,
    stockMax,
    salesMax,
    ctrMax,
  };
}

/**
 * Creates normalized hybrid relevance score.
 * @param {{
 *   lexicalScore: number,
 *   semanticScore: number,
 *   stock: number,
 *   sales: number,
 *   ctr: number,
 * }} raw Raw signal values.
 * @param {{
 *   lexicalMax: number,
 *   stockMax: number,
 *   salesMax: number,
 *   ctrMax: number,
 * }} maxValues Normalization maxima.
 * @return {number} Final hybrid score.
 */
function scoreHybridResult(raw, maxValues) {
  const lexicalNormalized = maxValues.lexicalMax > 0
    ? clamp(raw.lexicalScore / maxValues.lexicalMax, 0, 1)
    : 0;
  const semanticNormalized = clamp(raw.semanticScore, 0, 1);
  const stockNormalized = maxValues.stockMax > 0
    ? clamp(raw.stock / maxValues.stockMax, 0, 1)
    : 0;
  const salesNormalized = maxValues.salesMax > 0
    ? clamp(raw.sales / maxValues.salesMax, 0, 1)
    : 0;
  const ctrNormalized = maxValues.ctrMax > 0
    ? clamp(raw.ctr / maxValues.ctrMax, 0, 1)
    : 0;

  return (
    (semanticNormalized * 0.5) +
    (lexicalNormalized * 0.3) +
    (stockNormalized * 0.1) +
    (salesNormalized * 0.07) +
    (ctrNormalized * 0.03)
  );
}

/**
 * Merges two candidate arrays by product id.
 * @param {object[]} primary Primary candidate list.
 * @param {object[]} secondary Secondary candidate list.
 * @return {object[]} Merged deduplicated list.
 */
function mergeCandidates(primary, secondary) {
  const merged = new Map();

  [...primary, ...secondary].forEach((product) => {
    const productId = getProductId(product);
    if (!productId) {
      return;
    }

    const existing = merged.get(productId);
    if (!existing) {
      merged.set(productId, product);
      return;
    }

    const existingSemantic = toFiniteNumber(existing.semanticScore, 0);
    const nextSemantic = toFiniteNumber(product.semanticScore, 0);
    if (nextSemantic > existingSemantic) {
      merged.set(productId, {
        ...existing,
        ...product,
        score: Number.isFinite(existing.score) ? existing.score : product.score,
      });
    } else {
      merged.set(productId, {
        ...product,
        ...existing,
        semanticScore: Math.max(existingSemantic, nextSemantic),
      });
    }
  });

  return [...merged.values()];
}

/**
 * Re-ranks candidate products using semantic + lexical + business signals.
 * @param {{
 *   productSemanticSearchService: object,
 * }} deps Dependencies.
 * @param {{
 *   search: string,
 *   candidates: object[],
 *   limit: number,
 *   offset: number,
 * }} params Re-rank params.
 * @return {Promise<object[]>} Re-ranked products.
 */
async function rerankCandidates(deps, params) {
  const { productSemanticSearchService } = deps;
  const { search, candidates, limit, offset } = params;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const semanticScoresById = new Map();
  const candidateIds = candidates
    .map((candidate) => getProductId(candidate))
    .filter(Boolean);

  if (
    typeof search === 'string'
    && search.trim()
    && productSemanticSearchService
    && typeof productSemanticSearchService.isEnabled === 'function'
    && typeof productSemanticSearchService.scoreCandidateProducts === 'function'
    && productSemanticSearchService.isEnabled()
  ) {
    try {
      const semanticScores = await productSemanticSearchService.scoreCandidateProducts({
        search,
        candidateProductIds: candidateIds,
      });
      semanticScores.forEach((score, productId) => {
        semanticScoresById.set(productId, score);
      });
    } catch (error) {
      console.warn('Semantic reranking failed, using lexical/business ranking:', error.message);
    }
  }

  const entries = candidates.map((product) => {
    const productId = getProductId(product);
    const lexicalScore = Math.max(0, toFiniteNumber(product?.score, 0));
    const semanticScore = Math.max(
      0,
      toFiniteNumber(
        semanticScoresById.get(productId),
        toFiniteNumber(product?.semanticScore, 0)
      )
    );
    const stock = getTotalStock(product);
    const { sales, ctr } = getSalesAndCtr(product);

    return {
      product,
      lexicalScore,
      semanticScore,
      stock,
      sales,
      ctr,
    };
  });

  const signalMaxValues = getSignalMaxValues(entries);
  const ranked = entries
    .map((entry) => ({
      ...entry,
      finalScore: scoreHybridResult({
        lexicalScore: entry.lexicalScore,
        semanticScore: entry.semanticScore,
        stock: entry.stock,
        sales: entry.sales,
        ctr: entry.ctr,
      }, signalMaxValues),
    }))
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }
      return new Date(right.product.createdAt || 0).getTime()
        - new Date(left.product.createdAt || 0).getTime();
    });

  return ranked
    .slice(offset, offset + limit)
    .map((entry) => entry.product);
}

module.exports = {
  getProductId,
  getSalesAndCtr,
  getSignalMaxValues,
  getTotalStock,
  mergeCandidates,
  rerankCandidates,
  scoreHybridResult,
};
