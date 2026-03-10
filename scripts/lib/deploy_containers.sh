#!/usr/bin/env bash
#
# deploy_containers.sh — Pull/build and start the
# Docker Compose production stack.

# Guard against double-sourcing.
if [[ -n "${_DEPLOY_CONTAINERS_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _DEPLOY_CONTAINERS_SH_LOADED=1

#######################################
# Update stack containers without tearing down everything first.
# Globals:
#   COMPOSE_FILE
# Arguments:
#   skip_build — "true" to deploy prebuilt images (no local build).
# Outputs:
#   Writes progress to STDOUT; errors to STDERR.
#######################################
deploy_containers() {
  local skip_build="${1:-false}"

  if [[ "${skip_build}" == "true" ]]; then
    log::info "Pulling pre-built images from registry (IMAGE_TAG=${IMAGE_TAG:-latest})..."
    docker compose -f "${COMPOSE_FILE}" pull --ignore-buildable
    log::info "Starting containers (skip-build mode)..."
    docker compose -f "${COMPOSE_FILE}" up -d --no-build --remove-orphans
  else
    log::info "Building images and starting containers..."
    docker compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans
  fi

  log::info "Containers started"
}
