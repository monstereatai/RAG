FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY apps/preview-runner/package.json apps/preview-runner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps/preview-runner/src ./src

USER node
EXPOSE 4321
CMD ["node", "src/server.mjs"]
