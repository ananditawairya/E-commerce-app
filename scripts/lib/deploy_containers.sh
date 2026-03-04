#!/usr/bin/env bash
#
# deploy_containers.sh — Stop, optionally rebuild, and start the
# Docker Compose production stack.

# Guard against double-sourcing.
if [[ -n "${_DEPLOY_CONTAINERS_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _DEPLOY_CONTAINERS_SH_LOADED=1

#######################################
# Bring down existing containers, optionally prune the build cache,
# and start the stack.
# Globals:
#   COMPOSE_FILE
# Arguments:
#   skip_build — "true" to restart without rebuilding images.
# Outputs:
#   Writes progress to STDOUT; errors to STDERR.
#######################################
deploy_containers() {
  local skip_build="${1:-false}"

  docker compose -f "${COMPOSE_FILE}" down

  if [[ "${skip_build}" == "true" ]]; then
    log::info "Pulling pre-built images from registry..."
    docker compose -f "${COMPOSE_FILE}" pull --ignore-buildable 2>/dev/null \
      || docker compose -f "${COMPOSE_FILE}" pull || true
    log::info "Starting containers (skip-build mode)..."
    docker compose -f "${COMPOSE_FILE}" up -d
  else
    log::info "Building images and starting containers..."
    docker builder prune -af 2>/dev/null || true
    docker compose -f "${COMPOSE_FILE}" up -d --build
  fi

  log::info "Containers started"
}
