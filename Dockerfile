# Hosting image for the Solar Customer Files app (used by Render).
FROM node:22-bookworm-slim

# Chromium makes the PDFs. The fonts cover anything the bundled fonts do not.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Build the screens.
COPY client/package.json client/package-lock.json client/
RUN cd client && npm ci --include=dev --no-fund --no-audit
COPY client client
RUN cd client && npm run build && rm -rf node_modules

# Install the server.
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-fund --no-audit
COPY server server

# Panel and inverter datasheet PDFs.
COPY datasheets datasheets

# Uploaded PDFs are kept in Cloudinary (CLOUDINARY_URL). DATA_DIR only holds print files while
# the server is running; they are rebuilt when needed.
ENV NODE_ENV=production \
    PORT=10000 \
    DATA_DIR=/tmp/solar-data \
    DATASHEET_DIR=/app/datasheets

EXPOSE 10000
CMD ["node", "server/src/index.js"]
