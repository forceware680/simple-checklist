# Checklist Persediaan 2026 — image untuk deploy (Coolify / Docker)
FROM node:22-alpine

WORKDIR /app

# Install dependency produksi (reproducible via lockfile)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Salin source aplikasi (server.js, public/, OPDHerman.json)
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Jalankan sebagai user non-root bawaan image
USER node

CMD ["node", "server.js"]
