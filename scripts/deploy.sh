#!/usr/bin/env bash
#
# deploy.sh — Orchestrate the E-Commerce stack deployment.
#
# This is the main entry point called by the GitHub Actions CD workflow
# (via SSH) or manually on the EC2 instance.
#
# Usage:
#   ./scripts/deploy.sh                          # full deploy
#   ./scripts/deploy.sh --skip-build             # restart without rebuild
#   ./scripts/deploy.sh --seed                   # seed product DB after deploy
#   ./scripts/deploy.sh --skip-build --seed      # combine flags

set -euo pipefail

# ── Resolve script directory & source libraries ─────────────────────────────

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/load_secrets.sh"
source "${SCRIPT_DIR}/lib/deploy_containers.sh"
source "${SCRIPT_DIR}/lib/health_check.sh"
source "${SCRIPT_DIR}/lib/seed_db.sh"
source "${SCRIPT_DIR}/lib/init_ai.sh"

# ── Constants ───────────────────────────────────────────────────────────────

readonly APP_DIR="${APP_DIR:-/opt/ecom/app}"
readonly BRANCH="${DEPLOY_BRANCH:-main}"
readonly DEPLOY_COMMIT_SHA="${DEPLOY_COMMIT_SHA:-}"

# ── Functions ───────────────────────────────────────────────────────────────

#######################################
# Parse command-line flags.
# Globals:
#   SKIP_BUILD  (set)
#   SEED        (set)
# Arguments:
#   All command-line arguments ("$@").
#######################################
parse_flags() {
  SKIP_BUILD="false"
  SEED="false"

  for arg in "$@"; do
    case "${arg}" in
      --skip-build) SKIP_BUILD="true" ;;
      --seed)       SEED="true" ;;
      *)            log::warn "Unknown flag: ${arg}" ;;
    esac
  done
}

#######################################
# Safely sync code from Git:
# - fail if local tree is dirty (avoid deleting manual changes)
# - deploy exact commit when DEPLOY_COMMIT_SHA is set
# - otherwise fast-forward branch only (no forced reset)
# Globals:
#   APP_DIR
#   BRANCH
#   DEPLOY_COMMIT_SHA
# Arguments:
#   None
#######################################
pull_code() {
  log::info "Fetching latest Git refs..."
  cd "${APP_DIR}"

  git fetch --prune origin

  if [[ -n "$(git status --porcelain)" ]]; then
    log::err "Working tree has uncommitted changes; refusing deploy to avoid data loss."
  fi

  if [[ -n "${DEPLOY_COMMIT_SHA}" ]]; then
    if ! git rev-parse --verify --quiet "${DEPLOY_COMMIT_SHA}^{commit}" > /dev/null; then
      log::err "Deploy commit not found: ${DEPLOY_COMMIT_SHA}"
    fi

    log::info "Checking out deploy commit: ${DEPLOY_COMMIT_SHA}"
    git checkout --detach "${DEPLOY_COMMIT_SHA}"
  else
    log::info "Fast-forwarding branch: ${BRANCH}"
    git checkout "${BRANCH}" 2>/dev/null \
      || git checkout -b "${BRANCH}" "origin/${BRANCH}"
    git merge --ff-only "origin/${BRANCH}"
  fi

  log::info "Code updated"
}

#######################################
# Print a deployment summary with container status.
# Globals:
#   COMPOSE_FILE
# Arguments:
#   None
#######################################
print_summary() {
  log::step "Deployment complete!"
  docker compose -f "${COMPOSE_FILE}" ps
}

# ── Main ────────────────────────────────────────────────────────────────────

#######################################
# Main entry point — orchestrates the full deploy pipeline.
# Arguments:
#   All command-line arguments ("$@").
#######################################
main() {
  parse_flags "$@"

  log::step "Deploying branch: ${BRANCH}"
  if [[ -n "${DEPLOY_COMMIT_SHA}" ]]; then
    log::info "Pinned deploy commit: ${DEPLOY_COMMIT_SHA}"
  fi

  pull_code
  load_secrets
  deploy_containers "${SKIP_BUILD}"
  health_check

  if [[ "${SEED}" == "true" ]]; then
    seed_db
  fi

  init_ai
  print_summary
}

main "$@"
