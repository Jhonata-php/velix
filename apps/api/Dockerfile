# Debian Bookworm (glibc + OpenSSL 3) em vez de Alpine (musl): o engine do
# Prisma é um binário nativo escolhido por libc/versão do OpenSSL, e a
# detecção em Alpine (linux-musl + OpenSSL 1.1, ausente no Alpine 3.19+, que
# só traz OpenSSL 3) é uma fonte recorrente de "failed to detect libssl" e
# loops de restart. Bookworm elimina a classe inteira do problema em vez de
# tentar fixar `binaryTargets` e torcer pro binário certo existir.

# ---- build: compila TS -> JS, gera o client do Prisma ----------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# devDependencies (typescript, ts-node, @nestjs/cli, @types/*) só existem
# aqui — nunca entram na imagem final (ver stage "runtime" abaixo).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime: só o necessário pra rodar -------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ca-certificates: chamadas HTTPS de saída. postgresql-client: o pg_dump usado
# pelo backup automático — sem ele o backup falharia em runtime, num caminho que
# só roda de madrugada e ninguém veria falhar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# prisma/seed.js é JS puro versionado (não compilado do TS) — ver
# prisma/seed.js — por isso não precisa passar pelo stage de build.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/VERSION ./VERSION
COPY prisma ./prisma
COPY docker-entrypoint.sh wait-for-db.js ./
RUN chmod +x docker-entrypoint.sh

# Metadados de build — GET /api/health e o Centro de Atualizações mostram isso
# quando presente; sem --build-arg ficam null (não é erro). Declarados no fim
# de propósito: BUILD_DATE muda a cada build, e mais acima invalidaria o cache
# do apt e do npm ci, transformando toda atualização num build do zero.
ARG GIT_COMMIT=""
ARG BUILD_DATE=""
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_DATE=${BUILD_DATE}

EXPOSE 3001

# Sem curl/wget na imagem (mantém ela pequena) — Node 20 já tem fetch nativo.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
