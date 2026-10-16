FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer libreoffice-calc libreoffice-impress \
       fonts-liberation tesseract-ocr ocrmypdf poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "index.js"]
