#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker compose -f "$ROOT_DIR/docker/docker-compose.dev.yml" --profile graphrag config >/dev/null
docker compose -f "$ROOT_DIR/docker/docker-compose.staging.yml" --profile graphrag config >/dev/null
docker compose -f "$ROOT_DIR/docker/docker-compose.prod.yml" --profile graphrag config >/dev/null

echo "compose config ok"
