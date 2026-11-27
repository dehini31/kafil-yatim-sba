# Admin server: Node + Chromium (needed to print Arabic PDFs with the same engine as the preview).
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data PUBLISHER=github
VOLUME /data
EXPOSE 8787
USER pwuser
CMD ["node", "server/index.js"]
