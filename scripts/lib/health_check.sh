#!/usr/bin/env bash
#
# health_check.sh — Wait for the GraphQL gateway to report healthy.

# Guard against double-sourcing.
if [[ -n "${_HEALTH_CHECK_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _HEALTH_CHECK_SH_LOADED=1

#######################################
# Poll the health endpoint until it returns HTTP 2xx or the retry
# budget is exhausted.
# Globals:
#   HEALTH_URL
#   HEALTH_RETRIES
#   HEALTH_INTERVAL
#   COMPOSE_FILE
# Arguments:
#   None
# Outputs:
#   Writes progress to STDOUT; on failure dumps container logs to
#   STDERR and exits 1.
#######################################
health_check() {
  log::info "Waiting for health check at ${HEALTH_URL}..."

  local attempt
  for attempt in $(seq 1 "${HEALTH_RETRIES}"); do
    if curl -sf "${HEALTH_URL}" > /dev/null 2>&1; then
      log::info "Health check passed (attempt ${attempt}/${HEALTH_RETRIES})"
      return 0
    fi

    if (( attempt == HEALTH_RETRIES )); then
      echo "" >&2
      log::warn "Dumping container logs for debugging..."
      docker compose -f "${COMPOSE_FILE}" logs --tail=50 >&2
      log::err "Health check failed after ${HEALTH_RETRIES} attempts"
    fi

    sleep "${HEALTH_INTERVAL}"
  done
}
