#!/usr/bin/env bash
#
# init_ai.sh — Bootstrap the AI / semantic-search infrastructure:
# wait for Ollama, pull the embedding model, reindex, and verify.

# Guard against double-sourcing.
if [[ -n "${_INIT_AI_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _INIT_AI_SH_LOADED=1

readonly _OLLAMA_RETRIES=60
readonly _OLLAMA_INTERVAL=5
readonly _SEARCH_REINDEX_RETRIES=5
readonly _SEARCH_REINDEX_INTERVAL=4

#######################################
# Interprets common truthy values.
# Arguments:
#   Raw boolean-like value.
# Returns:
#   0 when truthy, 1 otherwise.
#######################################
is_true() {
  local value="${1:-}"
  local normalized
  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == "1" || "${normalized}" == "true" || "${normalized}" == "yes" || "${normalized}" == "on" ]]
}

#######################################
# Checks whether a compose service exists.
# Globals:
#   COMPOSE_FILE
# Arguments:
#   Service name.
# Returns:
#   0 when service exists, 1 otherwise.
#######################################
service_exists() {
  local service_name="${1:-}"
  docker compose -f "${COMPOSE_FILE}" config --services \
    | grep -q "^${service_name}$"
}

#######################################
# Wait for the Ollama container to be ready.
# Globals:
#   COMPOSE_FILE
# Arguments:
#   None
# Outputs:
#   Writes status to STDOUT; errors to STDERR.
# Returns:
#   0 when ready; exits 1 on timeout.
#######################################
_wait_for_ollama() {
  log::info "Waiting for Ollama..."

  local attempt
  for attempt in $(seq 1 "${_OLLAMA_RETRIES}"); do
    if docker exec ollama ollama list > /dev/null 2>&1; then
      log::info "Ollama ready (attempt ${attempt}/${_OLLAMA_RETRIES})"
      return 0
    fi

    if (( attempt == _OLLAMA_RETRIES )); then
      log::warn "Dumping Ollama logs..."
      docker compose -f "${COMPOSE_FILE}" logs --tail=50 ollama >&2
      log::err "Ollama did not become ready in time"
    fi

    sleep "${_OLLAMA_INTERVAL}"
  done
}

#######################################
# Pull the embedding model if it is not already present.
# Globals:
#   OLLAMA_MODEL
# Arguments:
#   None
# Outputs:
#   Writes status to STDOUT.
#######################################
_ensure_model() {
  if ! docker exec ollama ollama list \
       | awk 'NR>1 {print $1}' \
       | grep -qx "${OLLAMA_MODEL}"; then
    log::info "Pulling Ollama model: ${OLLAMA_MODEL}"
    docker exec ollama ollama pull "${OLLAMA_MODEL}"
  else
    log::info "Ollama model already available: ${OLLAMA_MODEL}"
  fi
}

#######################################
# Reindex the semantic product catalog and print status.
# Arguments:
#   None
# Outputs:
#   Writes reindex progress and semantic status to STDOUT.
#######################################
_reindex_catalog() {
  log::info "Reindexing semantic catalog..."
  docker exec product-service \
    node /app/product-service/scripts/reindexSemanticSearch.js

  log::info "Semantic search status:"
  docker exec product-service node -e \
    'fetch("http://127.0.0.1:4002/api/products/semantic/status")
       .then(async (r) => {
         if (!r.ok) throw new Error("HTTP " + r.status);
         console.log(await r.text());
       })
       .catch((e) => { console.error(e.message); process.exit(1); });'
  echo ""
}

#######################################
# Reindexes dedicated search engine catalog.
# Arguments:
#   None
# Outputs:
#   Writes reindex status to STDOUT.
#######################################
_reindex_search_engine() {
  log::info "Reindexing dedicated search engine catalog..."
  docker exec product-service \
    node /app/product-service/scripts/reindexSearchEngine.js
}

#######################################
# Top-level entry point:
# - bootstraps semantic indexing when enabled
# - bootstraps dedicated text search indexing when enabled
# Globals:
#   COMPOSE_FILE
#   OLLAMA_MODEL
# Arguments:
#   None
#######################################
init_ai() {
  if is_true "${SEARCH_SEMANTIC_ENABLED:-false}"; then
    if ! service_exists "ollama"; then
      log::warn "SEARCH_SEMANTIC_ENABLED=true but ollama service not found"
    else
      _wait_for_ollama
      _ensure_model
      _reindex_catalog
    fi
  else
    log::info "Semantic indexing disabled (SEARCH_SEMANTIC_ENABLED=false)"
  fi

  if ! is_true "${PRODUCT_SEARCH_ENGINE_ENABLED:-false}"; then
    log::info "Dedicated search engine disabled (PRODUCT_SEARCH_ENGINE_ENABLED=false)"
    return 0
  fi

  if ! service_exists "meilisearch"; then
    log::err "PRODUCT_SEARCH_ENGINE_ENABLED=true but meilisearch service not found"
  fi

  local attempt
  for attempt in $(seq 1 "${_SEARCH_REINDEX_RETRIES}"); do
    if _reindex_search_engine; then
      log::info "Dedicated search reindex complete (attempt ${attempt}/${_SEARCH_REINDEX_RETRIES})"
      return 0
    fi

    if (( attempt == _SEARCH_REINDEX_RETRIES )); then
      log::err "Dedicated search reindex failed after ${_SEARCH_REINDEX_RETRIES} attempts"
    fi

    log::warn "Dedicated search reindex attempt ${attempt} failed, retrying..."
    sleep "${_SEARCH_REINDEX_INTERVAL}"
  done
}
