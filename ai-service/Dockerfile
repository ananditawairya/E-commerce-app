FROM node:18-alpine AS deps
WORKDIR /app/ai-service
COPY ai-service/package*.json /app/ai-service/
RUN npm ci --omit=dev

FROM node:18-alpine
WORKDIR /app/ai-service
ENV NODE_ENV=production
COPY --from=deps /app/ai-service/node_modules /app/ai-service/node_modules
COPY ai-service /app/ai-service
COPY shared /app/shared
EXPOSE 4004
CMD ["node", "src/index.js"]
