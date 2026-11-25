# ---------- 阶段1：构建前端 ----------
FROM node:22-alpine AS build-web
WORKDIR /app/web
COPY web/package*.json ./
# playwright 只用于本地渲染验证，构建镜像时跳过浏览器下载
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 阶段2：编译 Go 后端 ----------
FROM golang:1.26-alpine AS build-backend
WORKDIR /src
RUN apk add --no-cache git
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/dockercfg-manager .

# ---------- 阶段3：运行 ----------
FROM alpine:3.24
RUN apk add --no-cache docker-cli docker-cli-compose ca-certificates tzdata \
    && docker compose version

WORKDIR /app
COPY --from=build-backend /out/dockercfg-manager /app/dockercfg-manager
COPY --from=build-web /app/web/dist/ /app/web/

ENV PORT=3001 \
    HOST=0.0.0.0 \
    COMPOSE_ROOT=/compose \
    DOCKER_SOCKET=/var/run/docker.sock \
    STATIC_DIR=/app/web

EXPOSE 3001
ENTRYPOINT ["/app/dockercfg-manager"]
