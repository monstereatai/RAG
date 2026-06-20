# ============================================================
# Backend Dockerfile（多阶段构建）
# Builder：npm ci + nest build（需要 devDependencies 含 @nestjs/cli）
# Runtime：仅生产依赖 + dist 产物，镜像更小
# ============================================================

# ---- 构建阶段 ----
FROM docker.m.daocloud.io/library/node:20.20.2-alpine AS builder
WORKDIR /app

# 先拷贝 package 文件，利用 docker 层缓存
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm ci --omit=optional --legacy-peer-deps

# 拷贝源码并构建
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM docker.m.daocloud.io/library/node:20.20.2-alpine
ENV NODE_ENV=production
WORKDIR /app

# 仅安装生产依赖
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm ci --omit=dev --omit=optional --legacy-peer-deps && \
    npm cache clean --force

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 创建工作区目录（文档上传等运行时使用）
RUN mkdir -p /app/workspace

EXPOSE 3000

# 使用 node 直接运行编译产物（不用 nest start，更轻量）
CMD ["node", "dist/main.js"]
