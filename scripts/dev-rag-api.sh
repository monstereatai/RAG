#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

LOG_LEVEL=${LOG_LEVEL:-debug}
export LOG_LEVEL

printf '[dev-rag-api] 仅启动 RAG API；日志输出到当前终端（LOG_LEVEL=%s）。按 Ctrl-C 停止。\n' "$LOG_LEVEL"
exec pnpm --filter backend start:dev
