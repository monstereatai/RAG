#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

missing=()

for file in docker/docker-compose.prod.yml docs/architecture/DEPLOYMENT.md ROADMAP.md; do
  if [[ ! -f "$file" ]]; then
    missing+=("$file")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  printf '{"ok":false,"error":"missing required files","files":['
  printf '"%s",' "${missing[@]}" | sed 's/,$//'
  printf ']}\n'
  exit 1
fi

compose_ok=true
compose_error=""
if ! compose_output="$(docker compose -f docker/docker-compose.prod.yml --profile graphrag config 2>&1)"; then
  compose_ok=false
  compose_error="$compose_output"
fi

redline_ok=true
redline_notes=()
if [[ -f backend/.env ]]; then
  redline_notes+=("backend/.env exists locally; keep it untracked and inject production secrets on the target machine")
fi
if git ls-files --error-unmatch backend/.env >/dev/null 2>&1; then
  redline_ok=false
  redline_notes+=("backend/.env is tracked by git")
fi

printf '{\n'
printf '  "ok": %s,\n' "$([[ "$compose_ok" == true && "$redline_ok" == true ]] && echo true || echo false)"
printf '  "composeConfigOk": %s,\n' "$compose_ok"
printf '  "redlineOk": %s,\n' "$redline_ok"
printf '  "requiredManualInputs": [\n'
printf '    "target machine and SSH access",\n'
printf '    "domain and TLS certificate strategy",\n'
printf '    "production secret injection strategy",\n'
printf '    "PostgreSQL/Milvus/MinIO/Redis/Neo4j backup strategy"\n'
printf '  ],\n'
printf '  "notes": ['
if [[ ${#redline_notes[@]} -gt 0 ]]; then
  for note in "${redline_notes[@]}"; do
    printf '"%s",' "$note"
  done | sed 's/,$//'
fi
printf ']'
if [[ "$compose_ok" != true ]]; then
  printf ',\n  "composeError": %s\n' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$compose_error")"
else
  printf '\n'
fi
printf '}\n'

if [[ "$compose_ok" != true || "$redline_ok" != true ]]; then
  exit 1
fi
