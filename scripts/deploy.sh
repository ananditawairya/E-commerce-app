#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# deploy.sh — Pull, build, deploy, and verify the E-Commerce stack
#
# Usage:
#   ./scripts/deploy.sh              # default: deploy all
#   ./scripts/deploy.sh --skip-build # restart without rebuilding
#   ./scripts/deploy.sh --seed       # also seed the product DB
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ───────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/ecom/app}"
COMPOSE_FILE="docker-compose.prod.yml"
BRANCH="${DEPLOY_BRANCH:-feature/Logger_And_Order_Tracking}"
HEALTH_URL="http://localhost:4000/health"
HEALTH_RETRIES=30
HEALTH_INTERVAL=5

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[  OK  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ WARN ]${NC} $*"; }
fail() { echo -e "${RED}[FAILED]${NC} $*"; exit 1; }

# ── Parse flags ─────────────────────────────────────────────
SKIP_BUILD=false
SEED=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --seed)       SEED=true ;;
    *)            warn "Unknown flag: $arg" ;;
  esac
done

# ── Step 1: Pull latest code ───────────────────────────────
log "Pulling latest from branch: $BRANCH"
cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
ok "Code updated"

# ── Step 2: Build & start ──────────────────────────────────
if [ "$SKIP_BUILD" = true ]; then
  log "Restarting containers (skip-build mode)..."
  docker compose -f "$COMPOSE_FILE" up -d
else
  log "Building images and starting containers..."
  docker compose -f "$COMPOSE_FILE" up -d --build
fi
ok "Containers started"

# ── Step 3: Health check ───────────────────────────────────
log "Waiting for gateway health check..."
for i in $(seq 1 $HEALTH_RETRIES); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    ok "Health check passed (attempt $i/$HEALTH_RETRIES)"
    break
  fi
  if [ "$i" -eq "$HEALTH_RETRIES" ]; then
    fail "Health check failed after $HEALTH_RETRIES attempts"
  fi
  echo -n "."
  sleep "$HEALTH_INTERVAL"
done

# ── Step 4: Seed DB (optional) ─────────────────────────────
if [ "$SEED" = true ]; then
  log "Seeding product database..."
  docker exec product-service node seed_products.js
  PRODUCT_COUNT=$(docker exec ecommerce-mongodb mongosh --quiet --eval \
    'db.getSiblingDB("product_db").products.countDocuments()')
  ok "Product DB seeded — $PRODUCT_COUNT products found"
fi

# ── Step 5: Summary ────────────────────────────────────────
echo ""
log "──────────────────────────────────────"
log "  Deployment complete!"
log "──────────────────────────────────────"
docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
ok "All done. Public endpoint: http://$(hostname -I | awk '{print $1}'):4000/health"
