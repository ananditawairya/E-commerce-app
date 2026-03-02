#!/usr/bin/env bash
#
# seed_db.sh — Seed the product database and verify the row count.

# Guard against double-sourcing.
if [[ -n "${_SEED_DB_SH_LOADED:-}" ]]; then
  return 0
fi
readonly _SEED_DB_SH_LOADED=1

#######################################
# Execute the product seeder inside the product-service container and
# print the resulting document count.
# Arguments:
#   None
# Outputs:
#   Writes seed status and product count to STDOUT.
#######################################
seed_db() {
  log::info "Seeding product database..."

  docker exec product-service node seed_products.js

  local product_count
  product_count="$(
    docker exec ecommerce-mongodb mongosh --quiet --eval \
      'db.getSiblingDB("product_db").products.countDocuments()'
  )"

  log::info "Product DB seeded — ${product_count} products"
}
