FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++ \
    && addgroup -S pxk \
    && adduser -S pxk -G pxk

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p /app/data/backups \
    && chown -R pxk:pxk /app

USER pxk

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
