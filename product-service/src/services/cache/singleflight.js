/**
 * Deduplicates concurrent async work by key.
 * @template T
 * @param {{inFlight: Map<string, Promise<T>>}} state Cache state.
 * @param {string} key Singleflight key.
 * @param {() => Promise<T>} fetcher Promise fetcher.
 * @return {Promise<T>} Shared result promise.
 */
function withSingleflight(state, key, fetcher) {
  if (!key) {
    return fetcher();
  }

  const existing = state.inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      state.inFlight.delete(key);
    }
  })();

  state.inFlight.set(key, promise);
  return promise;
}

module.exports = {
  withSingleflight,
};
