# ============================================================
# Frontend Dockerfile（多阶段构建）
# Builder：npm ci + vite build（产出静态资源）
# Runtime：nginx + dist 静态资源 + /api 反代到 backend
# ============================================================

# ---- 构建阶段 ----
FROM docker.m.daocloud.io/library/node:20.20.2-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm ci

COPY . .
RUN npm run build

# ---- 运行阶段：nginx ----
FROM docker.m.daocloud.io/library/nginx:1.29.3-alpine

# 拷贝自定义 nginx 配置（SPA 路由 + /api 反代）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 拷贝构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
