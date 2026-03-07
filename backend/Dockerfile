FROM node:20-alpine

WORKDIR /app

# Workspace manifests first for dependency layer caching.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY shared/commission-engine/package.json shared/commission-engine/package.json

RUN npm ci --workspaces --include-workspace-root=false

# Source code
COPY backend backend
COPY shared/commission-engine shared/commission-engine

ENV TZ=Asia/Shanghai
ENV PORT=3000

WORKDIR /app/backend
EXPOSE 3000

CMD ["sh", "-c", "npm run migrate && npm run start"]

