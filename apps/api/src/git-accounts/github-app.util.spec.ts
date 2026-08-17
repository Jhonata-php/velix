/**
 * Self-check das funções puras do fluxo de GitHub App — sem framework:
 *   npx ts-node src/git-accounts/github-app.util.spec.ts
 */
import assert from 'node:assert';
import { buildManifestName, buildManifest } from './github-app.util';

// nome curto: rótulo + sufixo, sem truncar
assert.equal(buildManifestName('Minha conta', 'ab12cd'), 'Velix Minha conta ab12cd');

// rótulo vazio cai num nome padrão em vez de "Velix  ab12cd" com espaço duplo
assert.equal(buildManifestName('', 'ab12cd'), 'Velix conta ab12cd');
assert.equal(buildManifestName('   ', 'ab12cd'), 'Velix conta ab12cd');

// rótulo muito longo é cortado (GitHub tem limite de comprimento pro nome do App)
const longLabel = 'a'.repeat(60);
const longName = buildManifestName(longLabel, 'ab12cd');
assert.ok(longName.length < 40, `nome muito longo: ${longName.length} caracteres`);
assert.ok(longName.endsWith('ab12cd'));

// manifest: URLs de callback batem com WEB_ORIGIN, sem barra duplicada
const manifest = buildManifest({ label: 'Minha conta', randomSuffix: 'ab12cd', webOrigin: 'https://velix.exemplo.com/' });
assert.equal(manifest.redirect_url, 'https://velix.exemplo.com/api/git-accounts/github/callback');
assert.equal(manifest.setup_url, 'https://velix.exemplo.com/api/git-accounts/github/installed');
assert.equal(manifest.public, false);
assert.deepEqual(manifest.default_events, []);
assert.deepEqual(manifest.default_permissions, { contents: 'read', metadata: 'read' });
assert.equal(manifest.hook_attributes.active, false);

console.log('github-app.util self-check OK');
