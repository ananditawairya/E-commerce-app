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
# Top-level entry point: only runs when the ollama service is defined
# in the active Compose file.
# Globals:
#   COMPOSE_FILE
#   OLLAMA_MODEL
# Arguments:
#   None
#######################################
init_ai() {
  if ! docker compose -f "${COMPOSE_FILE}" config --services \
       | grep -q '^ollama$'; then
    log::info "Ollama service not found in ${COMPOSE_FILE} — skipping AI init"
    return 0
  fi

  _wait_for_ollama
  _ensure_model
  _reindex_catalog
}
