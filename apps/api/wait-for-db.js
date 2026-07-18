// Checagem TCP simples antes de migrar. O docker-compose já usa
// depends_on + healthcheck do Postgres, mas isso cobre também o caso de o
// container rodar fora do compose (`docker run` direto) ou uma orquestração
// que não honra healthcheck de dependência.
const net = require('net');

const url = new URL(process.env.DATABASE_URL || 'postgresql://localhost:5432');
const host = url.hostname;
const port = Number(url.port) || 5432;

const MAX_ATTEMPTS = 30;
const DELAY_MS = 2000;

function attempt(n) {
  const socket = net.createConnection({ host, port }, () => {
    socket.end();
    process.exit(0);
  });
  socket.setTimeout(3000);
  socket.on('error', () => retry(n));
  socket.on('timeout', () => {
    socket.destroy();
    retry(n);
  });
}

function retry(n) {
  if (n >= MAX_ATTEMPTS) {
    console.error(`✗ PostgreSQL unreachable at ${host}:${port} after ${MAX_ATTEMPTS} attempts`);
    process.exit(1);
  }
  setTimeout(() => attempt(n + 1), DELAY_MS);
}

attempt(1);
