FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html ./
COPY src/ ./src/
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/ >/dev/null || exit 1
