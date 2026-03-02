#!/usr/bin/env bash
#
# common.sh — Shared constants, logging, and utility functions for the
# E-Commerce deployment pipeline.
#
# This file is a library and should be sourced, not executed directly.

# Guard against double-sourcing.
if [[ -n "${_COMMON_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _COMMON_SH_LOADED=1

# ── Constants ───────────────────────────────────────────────────────────────────

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly HEALTH_URL="http://localhost:4000/health"
readonly HEALTH_RETRIES=60
readonly HEALTH_INTERVAL=5
readonly OLLAMA_MODEL="${OLLAMA_EMBED_MODEL:-embeddinggemma}"

# ── Colors (disabled when NO_COLOR is set or stdout is not a terminal) ────────

if [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 ]]; then
  readonly RED='\033[0;31m'
  readonly GREEN='\033[0;32m'
  readonly YELLOW='\033[1;33m'
  readonly CYAN='\033[0;36m'
  readonly BOLD='\033[1m'
  readonly NC='\033[0m'
else
  readonly RED=''
  readonly GREEN=''
  readonly YELLOW=''
  readonly CYAN=''
  readonly BOLD=''
  readonly NC=''
fi

#######################################
# Print an informational message to STDOUT.
# Arguments:
#   Message string.
# Outputs:
#   Writes "[INFO]  <message>" to STDOUT.
#######################################
log::info() {
  echo -e "${GREEN}[INFO]${NC}  $*"
}

#######################################
# Print a warning message to STDERR.
# Arguments:
#   Message string.
# Outputs:
#   Writes "[WARN]  <message>" to STDERR.
#######################################
log::warn() {
  echo -e "${YELLOW}[WARN]${NC}  $*" >&2
}

#######################################
# Print an error message to STDERR and exit.
# Arguments:
#   Message string.
# Outputs:
#   Writes "[ERROR] <message>" to STDERR.
# Returns:
#   Exits with status 1.
#######################################
log::err() {
  echo -e "${RED}[ERROR]${NC} $*" >&2
  exit 1
}

#######################################
# Print a step header to STDOUT.
# Arguments:
#   Step description string.
# Outputs:
#   Writes a decorated header to STDOUT.
#######################################
log::step() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════${NC}"
  echo -e "${CYAN}  $*${NC}"
  echo -e "${CYAN}═══════════════════════════════════════${NC}"
}
