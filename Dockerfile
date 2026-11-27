# Admin server: Node + Chromium (needed to print Arabic PDFs with the same engine as the preview).
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data PUBLISHER=local BASE_PATH=/kafil PUBLIC_BASE_URL=https://dehini.com/kafil/ SITE_DIR=/data/site TRUST_PROXY=true ADMIN_URL=https://dehini.com/kafil/
VOLUME /data
EXPOSE 8787
USER pwuser
CMD ["node", "server/index.js"]
