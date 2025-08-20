FROM node:18-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production
COPY prisma ./prisma
COPY dist ./dist
COPY .env.example ./.env
# Create data directory for SQLite
RUN mkdir -p /data
ENV DATABASE_URL=file:/data/pos.db
EXPOSE 3000
CMD ["node", "dist/index.js"]