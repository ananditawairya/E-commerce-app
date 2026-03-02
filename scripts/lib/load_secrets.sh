#!/usr/bin/env bash
#
# load_secrets.sh — Validate and export runtime secrets injected by
# GitHub Actions into the SSH session environment.

# Guard against double-sourcing.
if [[ -n "${_LOAD_SECRETS_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _LOAD_SECRETS_SH_LOADED=1

# Required environment variables that must be set before calling this function.
readonly _REQUIRED_SECRETS=(
  "JWT_SECRET"
  "JWT_REFRESH_SECRET"
  "INTERNAL_JWT_SECRET"
  "GEMINI_API_KEY"
)

#######################################
# Converts common truthy values into "true"/"false".
# Arguments:
#   Raw boolean-like value.
# Outputs:
#   Writes "true" or "false" to STDOUT.
#######################################
normalize_bool() {
  local raw="${1:-}"
  local normalized
  normalized="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')"

  case "${normalized}" in
    1|true|yes|on) echo "true" ;;
    *)             echo "false" ;;
  esac
}

#######################################
# Validate that all required secret environment variables are set,
# then export them for docker-compose interpolation.
# Globals:
#   JWT_SECRET
#   JWT_REFRESH_SECRET
#   INTERNAL_JWT_SECRET
#   GEMINI_API_KEY
# Arguments:
#   None
# Outputs:
#   Writes status to STDOUT; errors to STDERR.
# Returns:
#   0 if all secrets are present, exits 1 otherwise.
#######################################
load_secrets() {
  local missing=()
  local product_search_enabled
  local semantic_enabled

  for secret in "${_REQUIRED_SECRETS[@]}"; do
    if [[ -z "${!secret:-}" ]]; then
      missing+=("${secret}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    log::err "Missing required secrets: ${missing[*]}"
  fi

  export JWT_SECRET
  export JWT_REFRESH_SECRET
  export INTERNAL_JWT_SECRET
  export GEMINI_API_KEY
  export MEILI_MASTER_KEY="${MEILI_MASTER_KEY:-}"

  product_search_enabled="$(normalize_bool "${PRODUCT_SEARCH_ENGINE_ENABLED:-true}")"
  semantic_enabled="$(normalize_bool "${SEARCH_SEMANTIC_ENABLED:-true}")"

  export PRODUCT_SEARCH_ENGINE_ENABLED="${product_search_enabled}"
  export SEARCH_SEMANTIC_ENABLED="${semantic_enabled}"
  export OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-embeddinggemma}"

  if [[ "${PRODUCT_SEARCH_ENGINE_ENABLED}" == "true" ]] \
    && [[ -z "${MEILI_MASTER_KEY}" ]]; then
    log::err "MEILI_MASTER_KEY is required when PRODUCT_SEARCH_ENGINE_ENABLED=true"
  fi

  if [[ "${SEARCH_SEMANTIC_ENABLED}" == "true" ]] \
    && [[ -z "${OLLAMA_EMBED_MODEL}" ]]; then
    log::err "OLLAMA_EMBED_MODEL is required when SEARCH_SEMANTIC_ENABLED=true"
  fi

  log::info "Runtime secrets loaded from GitHub Actions"
}
