#!/usr/bin/env bash
# ============================================================
# Docker 服务盘点（只读）
#
# 只打印信息，不做任何 stop / rm / prune / down 操作，可安全随时执行。
# 用法：./scripts/docker-status.sh
# ============================================================
set -uo pipefail

# 本仓库涉及的三套 compose：项目名 -> compose 文件
COMPOSE_FILES=(
  "docker/docker-compose.yml"
  "docker/docker-compose.dev.yml"
  "docker/docker-compose.prod.yml"
  "docker/docker-compose.staging.yml"
  "monitoring/docker-compose.monitoring.yml"
  "admin-backend/docker/docker-compose.yml"
)

echo "== Docker 引擎 =="
docker version --format '  client {{.Client.Version}} / server {{.Server.Version}}' 2>/dev/null || echo "  Docker 未运行"
docker system df 2>/dev/null | sed 's/^/  /'

echo
echo "== 本仓库容器（按 compose 项目分组）=="
for project in docker monitoring; do
  names=$(docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.Names}}' | tr '\n' ' ')
  if [[ -z "$names" ]]; then
    echo "  [${project}] 无容器"
    continue
  fi
  echo "  [${project}]"
  docker ps -a --filter "label=com.docker.compose.project=${project}" \
    --format '    {{.Names}}\t{{.Status}}\t{{.Ports}}'
done

echo
echo "== 未被上述项目管理的本仓库相关容器（按名字前缀兜底）=="
docker ps -a --format '{{.Names}}' | grep -E '^(rag-|nestjs-enterprise|mysql-master|mysql-slave)' \
  | while read -r name; do
      project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null)
      if [[ "$project" != "docker" && "$project" != "monitoring" ]]; then
        echo "    ${name} (project=${project:-none})"
      fi
    done

echo
echo "== 本仓库数据卷（数据都在这里，删除前务必备份）=="
docker volume ls --format '{{.Name}}' | grep -E '^(docker|docker_dev|monitoring)_' | sort | sed 's/^/  /'

echo
echo "== 端口占用（本仓库相关）=="
for port in 3000 3001 3030 5432 6379 9090 9091 9093 19530; do
  owner=$(docker ps --format '{{.Names}}|{{.Ports}}' | grep -E ":${port}->" | cut -d'|' -f1 | head -1)
  if [[ -n "$owner" ]]; then
    printf '  %-6s 容器 %s\n' "$port" "$owner"
  else
    host_pid=$(lsof -tnP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)
    if [[ -n "$host_pid" ]]; then
      printf '  %-6s 宿主机进程 pid=%s\n' "$port" "$host_pid"
    else
      printf '  %-6s 空闲\n' "$port"
    fi
  fi
done

echo
echo "== compose 文件语法校验（只读）=="
for file in "${COMPOSE_FILES[@]}"; do
  if [[ -f "$file" ]]; then
    if docker compose -f "$file" config -q 2>/dev/null; then
      echo "  OK    $file"
    else
      echo "  FAIL  $file"
    fi
  else
    echo "  MISS  $file"
  fi
done

echo
echo "提示：本脚本只读。停服务用 docker stop <名字>；"
echo "      不要用 docker compose down -v / docker system prune，会删数据卷或镜像。"
