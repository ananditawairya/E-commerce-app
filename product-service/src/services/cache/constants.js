const DEFAULT_TTL_MS = Number.parseInt(
  process.env.PRODUCT_CACHE_DEFAULT_TTL_MS || '120000',
  10
);
const JITTER_RATIO = Number.parseFloat(
  process.env.PRODUCT_CACHE_TTL_JITTER_RATIO || '0.2'
);
const MEMORY_SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.PRODUCT_CACHE_SWEEP_INTERVAL_MS || '60000',
  10
);
const NAMESPACE_VERSION_PREFIX = 'product:cache:ns:v1:';

module.exports = {
  DEFAULT_TTL_MS,
  JITTER_RATIO,
  MEMORY_SWEEP_INTERVAL_MS,
  NAMESPACE_VERSION_PREFIX,
};
