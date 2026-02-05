FROM node:18-alpine AS deps
WORKDIR /app/order-service
COPY order-service/package*.json /app/order-service/
RUN npm ci --omit=dev

FROM node:18-alpine
WORKDIR /app/order-service
ENV NODE_ENV=production
COPY --from=deps /app/order-service/node_modules /app/order-service/node_modules
COPY order-service /app/order-service
COPY shared /app/shared
EXPOSE 4003
CMD ["node", "src/index.js"]
