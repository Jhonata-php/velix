# Mesma base do apps/api/Dockerfile (Debian Bookworm) por consistência — o
# frontend não tem o problema de binário nativo do Prisma, mas manter os dois
# serviços na mesma libc/base evita divergência de comportamento por acaso.

# ---- build: compila o Next.js -----------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: só o necessário pra servir -------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/server.js ./server.js
# public/ tem os assets estáticos servidos na raiz (logos reais dos apps da
# Biblioteca, favicon, etc.) — sem isso a imagem builda e sobe normalmente,
# mas todo /app-icons/*.svg responde 404 em produção.
COPY --from=build /app/public ./public

EXPOSE 3000

# /login é uma página pública (sem autenticação, sem depender do backend) —
# healthcheck real de "o Next.js está servindo", não só "o processo existe".
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
