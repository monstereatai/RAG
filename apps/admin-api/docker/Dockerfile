# 多阶段构建
FROM node:18-alpine as builder

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装完整依赖用于构建
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 删除开发依赖，保留生产依赖给运行阶段复用
RUN npm prune --omit=dev

# 生产阶段
FROM node:18-alpine as production

# 安装必要的系统依赖
RUN apk add --no-cache dumb-init curl mariadb-client

# 创建应用用户
RUN addgroup -g 1001 -S nestjs && \
    adduser -S nestjs -u 1001

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# 复制构建结果
COPY --from=builder --chown=nestjs:nestjs /app/dist ./dist
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules

# 复制入口脚本
COPY --chown=nestjs:nestjs docker/entrypoint.sh /entrypoint.sh

# 创建日志目录
RUN mkdir -p /var/log/nestjs && chown nestjs:nestjs /var/log/nestjs

# 设置权限
RUN chmod +x /entrypoint.sh

# 切换到非root用户
USER nestjs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# 启动应用
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/main.js"]
