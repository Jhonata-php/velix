const { createServer } = require('http');
const { parse } = require('url');
const net = require('net');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const port = process.env.PORT || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

const internalApiUrl = new URL(process.env.INTERNAL_API_URL ?? 'http://localhost:3001/api');

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  // Repassa upgrades de WebSocket em /terminal e /ops direto pro backend, via
  // socket TCP cru — assim terminal e logs ao vivo funcionam sem precisar de
  // uma segunda porta exposta (rewrites do Next não proxeiam upgrade de WebSocket).
  //
  // ponytail-bugfix: pra qualquer OUTRO upgrade (ex.: o WebSocket de Hot
  // Reload do próprio Next em dev, /_next/webpack-hmr) a gente só ignora e
  // retorna — nunca dar `socket.destroy()` aqui, senão quebra o HMR do Next
  // (que registra seu próprio listener de 'upgrade' no mesmo server), o que
  // em cascata quebra até o carregamento de chunks dinâmicos no browser.
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/terminal') && !req.url.startsWith('/ops')) {
      return;
    }

    const target = net.connect(Number(internalApiUrl.port), internalApiUrl.hostname, () => {
      const requestLine = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        requestLine.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      target.write(requestLine.join('\r\n') + '\r\n\r\n');
      if (head && head.length) target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });

  server.listen(port, () => {
    console.log(`Velix web rodando na porta ${port}`);
  });
});
