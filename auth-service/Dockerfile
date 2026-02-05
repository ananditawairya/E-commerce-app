FROM node:18-alpine AS deps
WORKDIR /app/auth-service
COPY auth-service/package*.json /app/auth-service/
RUN npm ci --omit=dev

FROM node:18-alpine
WORKDIR /app/auth-service
ENV NODE_ENV=production
COPY --from=deps /app/auth-service/node_modules /app/auth-service/node_modules
COPY auth-service /app/auth-service
COPY shared /app/shared
EXPOSE 4001
CMD ["node", "src/index.js"]
