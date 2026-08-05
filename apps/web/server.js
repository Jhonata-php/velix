const { createServer } = require('http');
const http = require('http');
const { parse } = require('url');
const net = require('net');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const port = process.env.PORT || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

// ponytail-bugfix: lido a cada request/upgrade, nunca guardado numa constante
// no escopo do módulo. O rewrites() do next.config.js parecia mais simples,
// mas resolve `process.env.INTERNAL_API_URL` só uma vez — no build — e
// congela isso no routes-manifest.json. Isso quebra em produção Docker: a
// imagem é construída sem o hostname do serviço (ex. "api"), então o proxy
// tentava sempre falar com o fallback "localhost", que não existe dentro do
// container do frontend. Por isso o proxy de /api/* e dos WebSockets inteiro
// mora aqui, em vez de depender do rewrites do Next.
function getInternalApiUrl() {
  return new URL(process.env.INTERNAL_API_URL ?? 'http://localhost:3001/api');
}

// A API enxerga só a conexão deste container, então o IP real do usuário
// precisa chegar por header — é ele que aparece em "Sessões ativas", na
// auditoria e no rate limit de login.
//
// Com domínio: o Traefik já sanitiza o X-Forwarded-For (descarta o que o
// cliente mandar e escreve o IP real), então repassar é seguro. Sem domínio
// não há proxy na frente: qualquer X-Forwarded-For que chegue veio do próprio
// cliente e é chute — sobrescreve com o endereço do socket, que não dá pra
// forjar. Ver client-ip.util.ts no lado da API.
function forwardedHeaders(req) {
  const behindTraefik = !!process.env.VELIX_DOMAIN;
  const forwarded = behindTraefik ? req.headers['x-forwarded-for'] : null;
  return { ...req.headers, 'x-forwarded-for': forwarded || req.socket.remoteAddress || '' };
}

function proxyApiRequest(req, res) {
  const target = getInternalApiUrl();
  const proxyReq = http.request(
    { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: forwardedHeaders(req) },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 502, message: `Falha ao repassar para o backend: ${err.message}` }));
  });
  req.pipe(proxyReq);
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      proxyApiRequest(req, res);
      return;
    }
    handle(req, res, parse(req.url, true));
  });

  // Repassa upgrades de WebSocket em /terminal, /ops e /db-console direto pro
  // backend, via socket TCP cru — assim terminal, logs ao vivo e o console de
  // banco funcionam sem precisar de uma segunda porta exposta.
  //
  // ponytail-bugfix: pra qualquer OUTRO upgrade (ex.: o WebSocket de Hot
  // Reload do próprio Next em dev, /_next/webpack-hmr) a gente só ignora e
  // retorna — nunca dar `socket.destroy()` aqui, senão quebra o HMR do Next
  // (que registra seu próprio listener de 'upgrade' no mesmo server), o que
  // em cascata quebra até o carregamento de chunks dinâmicos no browser.
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/terminal') && !req.url.startsWith('/ops') && !req.url.startsWith('/db-console')) {
      return;
    }

    const target = getInternalApiUrl();
    const conn = net.connect(Number(target.port), target.hostname, () => {
      const requestLine = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        requestLine.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      conn.write(requestLine.join('\r\n') + '\r\n\r\n');
      if (head && head.length) conn.write(head);
      conn.pipe(socket);
      socket.pipe(conn);
    });
    conn.on('error', () => socket.destroy());
    socket.on('error', () => conn.destroy());
  });

  server.listen(port, () => {
    console.log(`Velix web rodando na porta ${port}`);
  });
});
