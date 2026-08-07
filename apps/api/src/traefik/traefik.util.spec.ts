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
  upsertEnvVar,
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

// upsertEnvVar — regressão do SSL quebrado no servidor local: grava
// CF_DNS_API_TOKEN sem tocar em mais nada do .env.
{
  const original = 'POSTGRES_PASSWORD=abc\nJWT_SECRET=def\nWEB_ORIGIN=https://x.com\n';

  // chave nova: aparece no fim, resto idêntico
  const withToken = upsertEnvVar(original, 'CF_DNS_API_TOKEN', 'tok123');
  assert.ok(withToken.includes('CF_DNS_API_TOKEN=tok123'));
  assert.ok(withToken.includes('POSTGRES_PASSWORD=abc'));
  assert.ok(withToken.includes('JWT_SECRET=def'));
  assert.ok(withToken.includes('WEB_ORIGIN=https://x.com'));
  assert.equal((withToken.match(/CF_DNS_API_TOKEN=/g) ?? []).length, 1);

  // chave já existente: substitui no lugar, não duplica, resto continua igual
  const replaced = upsertEnvVar(withToken, 'CF_DNS_API_TOKEN', 'tok456');
  assert.ok(replaced.includes('CF_DNS_API_TOKEN=tok456'));
  assert.ok(!replaced.includes('tok123'));
  assert.equal((replaced.match(/CF_DNS_API_TOKEN=/g) ?? []).length, 1);
  assert.ok(replaced.includes('POSTGRES_PASSWORD=abc'), 'outras variáveis não podem ser afetadas');

  // idempotente: aplicar o mesmo valor de novo não muda nada
  assert.equal(upsertEnvVar(replaced, 'CF_DNS_API_TOKEN', 'tok456'), replaced);

  // arquivo sem \n final continua sem \n final quando só substitui (não anexa)
  const noNewline = 'A=1\nB=2';
  const stillNoNewline = upsertEnvVar(noNewline, 'A', '9');
  assert.equal(stillNoNewline, 'A=9\nB=2');

  // não confunde CF_DNS_API_TOKEN com uma chave que só começa parecido
  const tricky = upsertEnvVar('CF_DNS_API_TOKEN_OLD=x\n', 'CF_DNS_API_TOKEN', 'novo');
  assert.ok(tricky.includes('CF_DNS_API_TOKEN_OLD=x'), 'prefixo parecido não pode ser sobrescrito');
  assert.ok(tricky.includes('CF_DNS_API_TOKEN=novo'));
}

console.log('traefik.util self-check OK');
