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

  log::info "Runtime secrets loaded from GitHub Actions"
}
