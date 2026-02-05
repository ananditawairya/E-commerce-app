FROM node:18-alpine AS deps
WORKDIR /app/graphql-gateway
COPY graphql-gateway/package*.json /app/graphql-gateway/
RUN npm ci --omit=dev

FROM node:18-alpine
WORKDIR /app/graphql-gateway
ENV NODE_ENV=production
COPY --from=deps /app/graphql-gateway/node_modules /app/graphql-gateway/node_modules
COPY graphql-gateway /app/graphql-gateway
EXPOSE 4000
CMD ["node", "src/index.js"]
