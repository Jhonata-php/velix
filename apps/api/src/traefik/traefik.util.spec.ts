/**
 * Self-check das funções puras do Traefik — sem framework, roda com:
 *   npx ts-node src/traefik/traefik.util.spec.ts
 * (mesmo estilo do prisma/seed.ts, que também roda via ts-node).
 */
import assert from 'node:assert';
import {
  renderDynamicRoute,
  renderDynamicRouteToContainer,
  renderStaticConfig,
  parseTraefikVersion,
  isContainerUp,
  isValidAcmeEmail,
  routerName,
} from './traefik.util';

// routerName: prefixo "velix-" + id sem hífens (nome válido de router no Traefik)
assert.equal(routerName('a1b2-c3d4-e5'), 'velix-a1b2c3d4e5');

// dynamic route contém hostname, porta e o resolver de TLS
const dyn = renderDynamicRoute({ name: 'velixabc', hostname: 'app.exemplo.com', targetPort: 3001 });
assert.ok(dyn.includes('Host(`app.exemplo.com`)'), 'deve conter a regra de Host');
assert.ok(dyn.includes('http://host.docker.internal:3001'), 'deve apontar pra porta no host');
assert.ok(dyn.includes('certResolver: velix-le'), 'deve usar o resolver velix-le');

// dynamic route pra aplicação: aponta pro nome do container, não pro host
const dynApp = renderDynamicRouteToContainer({ name: 'velixdef', hostname: 'kuma.exemplo.com', containerName: 'meuapp_app', containerPort: 3001 });
assert.ok(dynApp.includes('Host(`kuma.exemplo.com`)'));
assert.ok(dynApp.includes('http://meuapp_app:3001'), 'deve apontar pro nome do container na rede velix-proxy');
assert.ok(!dynApp.includes('host.docker.internal'), 'não deve usar o alvo de porta-no-host pra aplicações');

// static config: HTTP->HTTPS, dashboard/api inseguros desligados, email do ACME
const stat = renderStaticConfig('admin@exemplo.com');
assert.ok(stat.includes('scheme: https'), 'deve redirecionar pra https');
assert.ok(stat.includes('email: admin@exemplo.com'), 'deve conter o email do ACME');
assert.ok(/dashboard:\s*false/.test(stat), 'dashboard deve estar desligado');
assert.ok(/insecure:\s*false/.test(stat), 'api insegura deve estar desligada');
assert.ok(stat.includes('provider: cloudflare'), 'DNS-01 via cloudflare');

// parse de versão
assert.equal(parseTraefikVersion('Version: 3.3.1\nCodename: saintnectaire'), '3.3.1');
assert.equal(parseTraefikVersion('Version:\tv3.3.0'), '3.3.0');
assert.equal(parseTraefikVersion('sem versão aqui'), null);

// status do container
assert.equal(isContainerUp('Up 3 hours'), true);
assert.equal(isContainerUp('Exited (0) 2 minutes ago'), false);
assert.equal(isContainerUp(''), false);

// email de contato ACME: rejeita TLDs não-públicos (bug real que travava toda
// emissão de certificado silenciosamente) e aceita e-mails válidos de verdade
assert.equal(isValidAcmeEmail('admin@velix.local'), false);
assert.equal(isValidAcmeEmail('admin@velix.test'), false);
assert.equal(isValidAcmeEmail('sememail'), false);
assert.equal(isValidAcmeEmail('sem@dominio'), false);
assert.equal(isValidAcmeEmail('admin@meudominio.com'), true);
assert.equal(isValidAcmeEmail('  admin@meudominio.com.br  '), true);

console.log('traefik.util self-check OK');
