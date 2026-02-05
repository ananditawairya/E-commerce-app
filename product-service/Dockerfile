FROM node:18-alpine AS deps
WORKDIR /app/product-service
COPY product-service/package*.json /app/product-service/
RUN npm ci --omit=dev

FROM node:18-alpine
WORKDIR /app/product-service
ENV NODE_ENV=production
COPY --from=deps /app/product-service/node_modules /app/product-service/node_modules
COPY product-service /app/product-service
COPY shared /app/shared
EXPOSE 4002
CMD ["node", "src/index.js"]
