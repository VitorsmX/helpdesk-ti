# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY prisma ./prisma/
COPY public ./public/
COPY scripts ./scripts/

RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl netcat-openbsd

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --chown=node:node package.json ./

RUN mkdir -p /app/uploads /app/logs \
  && chmod +x ./scripts/docker-entrypoint.sh \
  && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000; fetch('http://127.0.0.1:'+port+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
