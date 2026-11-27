# Admin server: plain Node (PDFs are drawn directly, no browser needed).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data PUBLISHER=local BASE_PATH=/kafil PUBLIC_BASE_URL=https://dehini.com/kafil/ SITE_DIR=/data/site TRUST_PROXY=true ADMIN_URL=https://dehini.com/kafil/
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server/index.js"]
