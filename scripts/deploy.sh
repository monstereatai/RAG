#!/usr/bin/env bash
# ============================================================
# 一键部署脚本（模板）
# 用法: ./scripts/deploy.sh [environment]
#   environment: production (默认) | staging
# 注意：首次使用前先编辑配置变更为实际路径
# ============================================================
set -euo pipefail

DEPLOY_ENV="${1:-production}"
DEPLOY_DIR="/opt/rag"
BACKEND_DIR="${DEPLOY_DIR}/backend"
ADMIN_BACKEND_DIR="${DEPLOY_DIR}/admin-backend"
ADMIN_DIR="${DEPLOY_DIR}/admin"
DOCKER_DIR="${DEPLOY_DIR}/docker"
LOG_FILE="/var/log/rag-deploy.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploying RAG (${DEPLOY_ENV})..." | tee -a "${LOG_FILE}"

# Step 1: Pull latest code
echo ">>> Pulling latest code..."
cd "${DEPLOY_DIR}"
git pull origin main 2>&1 | tee -a "${LOG_FILE}"

# Step 2: Start infra services
echo ">>> Starting infrastructure services..."
cd "${DOCKER_DIR}"
docker compose up -d postgres redis milvus 2>&1 | tee -a "${LOG_FILE}"
echo ">>> Waiting for Milvus to be ready..."
sleep 10

# Step 3: Build & start backend
echo ">>> Building backend..."
cd "${BACKEND_DIR}"
npm ci --omit=dev 2>&1 | tee -a "${LOG_FILE}"
npm run build 2>&1 | tee -a "${LOG_FILE}"

echo ">>> Starting backend..."
# 使用 PM2 或 screen 启动；生产建议 PM2
if command -v pm2 &>/dev/null; then
  pm2 delete rag-backend 2>/dev/null || true
  NODE_ENV=production pm2 start dist/src/main.js --name rag-backend 2>&1 | tee -a "${LOG_FILE}"
else
  echo "WARNING: pm2 not found, using nohup. Install pm2 for production: npm i -g pm2"
  pkill -f "dist/src/main.js" 2>/dev/null || true
  nohup node dist/src/main.js > /var/log/rag-backend.log 2>&1 &
fi

# Step 4: Build & start admin-backend
echo ">>> Building admin-backend..."
cd "${ADMIN_BACKEND_DIR}"
npm ci --omit=dev 2>&1 | tee -a "${LOG_FILE}"
npm run build 2>&1 | tee -a "${LOG_FILE}"

echo ">>> Starting admin-backend..."
if command -v pm2 &>/dev/null; then
  pm2 delete rag-admin-backend 2>/dev/null || true
  NODE_ENV=production pm2 start dist/main.js --name rag-admin-backend 2>&1 | tee -a "${LOG_FILE}"
else
  pkill -f "admin-backend" 2>/dev/null || true
  nohup node dist/main.js > /var/log/rag-admin-backend.log 2>&1 &
fi

# Step 5: Build admin frontend
echo ">>> Building admin frontend..."
cd "${ADMIN_DIR}"
npm ci 2>&1 | tee -a "${LOG_FILE}"
npm run build 2>&1 | tee -a "${LOG_FILE}"

# Step 6: Verify
echo ">>> Verifying deployment..."
sleep 5
HEALTH_RESPONSE=$(curl -s --connect-timeout 5 http://localhost:3000/api/v1/health 2>/dev/null || echo "FAILED")
if echo "${HEALTH_RESPONSE}" | grep -q '"code":200'; then
  echo "✅ Backend health check passed"
else
  echo "❌ Backend health check failed: ${HEALTH_RESPONSE}"
fi

ADMIN_HEALTH=$(curl -s --connect-timeout 5 http://localhost:3001/health 2>/dev/null || echo "FAILED")
if echo "${ADMIN_HEALTH}" | grep -q '"code":200'; then
  echo "✅ Admin-backend health check passed"
else
  echo "❌ Admin-backend health check failed: ${ADMIN_HEALTH}"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deployment complete." | tee -a "${LOG_FILE}"
echo "Next: verify at https://your-domain.com"
