/**
 * Self-check: npx ts-node src/traefik/certificate.util.spec.ts
 * Gera um certificado autoassinado de verdade via `openssl` (só neste teste,
 * não em produção) pra validar o parser contra um X.509 real, não um mock.
 */
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCertificateInAcmeJson, parseCertificate } from './certificate.util';

const dir = mkdtempSync(join(tmpdir(), 'velix-cert-test-'));
const keyPath = join(dir, 'key.pem');
const certPath = join(dir, 'cert.pem');
execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 30 -nodes -subj "/CN=status.exemplo.com.br"`,
  { stdio: 'pipe' },
);
const pem = readFileSync(certPath, 'utf8');
const base64Cert = Buffer.from(pem, 'utf8').toString('base64');

// acme.json real do Traefik v3: encontra pelo domínio certo, não acha outro
const acmeJson = JSON.stringify({
  'velix-le': {
    Certificates: [{ domain: { main: 'status.exemplo.com.br' }, certificate: base64Cert }],
  },
});
assert.equal(findCertificateInAcmeJson(acmeJson, 'status.exemplo.com.br'), base64Cert);
assert.equal(findCertificateInAcmeJson(acmeJson, 'outro.exemplo.com.br'), null);
assert.equal(findCertificateInAcmeJson('não é json', 'status.exemplo.com.br'), null);

// certificado real de 30 dias: ACTIVE, emissor/validade extraídos de verdade
const info = parseCertificate(base64Cert);
assert.equal(info.state, 'ACTIVE');
assert.ok(info.issuer?.includes('status.exemplo.com.br'));
assert.ok((info.daysRemaining ?? 0) > 25);

// certificado inválido não derruba nada, vira estado ERROR
const bad = parseCertificate(Buffer.from('lixo').toString('base64'));
assert.equal(bad.state, 'ERROR');

rmSync(dir, { recursive: true, force: true });
console.log('certificate.util self-check OK');
