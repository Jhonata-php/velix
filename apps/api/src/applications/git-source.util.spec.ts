/**
 * Self-check das funções puras da implantação por repositório — sem framework:
 *   npx ts-node src/applications/git-source.util.spec.ts
 */
import assert from 'node:assert';
import {
  validateRepoUrl,
  validateGitRef,
  validateDockerfilePath,
  cloneUrlWithToken,
  redactToken,
  renderGitCompose,
} from './git-source.util';

// --- URL do repositório -----------------------------------------------------

const ok = validateRepoUrl('https://github.com/usuario/projeto');
assert.equal(ok.ok, true);
assert.equal(ok.ok && ok.url, 'https://github.com/usuario/projeto.git');

// sufixo .git e barras extras não mudam o resultado
assert.equal(validateRepoUrl('https://github.com/usuario/projeto.git/').ok, true);

// esquemas perigosos: `ext::` do git executa comando local — é execução remota
// de comando disfarçada de URL
assert.equal(validateRepoUrl('ext::sh -c whoami').ok, false);
assert.equal(validateRepoUrl('file:///etc/passwd').ok, false);
assert.equal(validateRepoUrl('git@github.com:usuario/projeto.git').ok, false);
assert.equal(validateRepoUrl('http://github.com/usuario/projeto').ok, false);

// host fora da lista
assert.equal(validateRepoUrl('https://exemplo.com/usuario/projeto').ok, false);

// credencial embutida na URL tem que ser recusada — o campo certo é o de token
assert.equal(validateRepoUrl('https://user:senha@github.com/a/b').ok, false);

// caminho que não é usuário/projeto
assert.equal(validateRepoUrl('https://github.com/usuario').ok, false);
assert.equal(validateRepoUrl('https://github.com/a/b/c').ok, false);

// --- ref do git -------------------------------------------------------------

assert.equal(validateGitRef('main'), true);
assert.equal(validateGitRef('feature/x-1'), true);
assert.equal(validateGitRef('v1.2.3'), true);
assert.equal(validateGitRef('a1b2c3d'), true);
assert.equal(validateGitRef(''), false);
assert.equal(validateGitRef('main; rm -rf /'), false);
assert.equal(validateGitRef('$(whoami)'), false);
assert.equal(validateGitRef('main branch'), false);
// não pode começar com '-', senão o git trata como flag
assert.equal(validateGitRef('--upload-pack=evil'), false);

// --- caminho do Dockerfile --------------------------------------------------

assert.equal(validateDockerfilePath('Dockerfile'), true);
assert.equal(validateDockerfilePath('docker/prod.Dockerfile'), true);
assert.equal(validateDockerfilePath('/etc/passwd'), false);
assert.equal(validateDockerfilePath('../../../etc/passwd'), false);
assert.equal(validateDockerfilePath('Dockerfile; cat /etc/shadow'), false);

// --- token no clone ---------------------------------------------------------

assert.equal(cloneUrlWithToken('https://github.com/a/b.git'), 'https://github.com/a/b.git');
assert.equal(
  cloneUrlWithToken('https://github.com/a/b.git', 'abc123'),
  'https://x-access-token:abc123@github.com/a/b.git',
);
// token com caracteres que quebrariam o parsing da URL
assert.equal(
  cloneUrlWithToken('https://github.com/a/b.git', 'ab/c@d'),
  'https://x-access-token:ab%2Fc%40d@github.com/a/b.git',
);

// --- redação do token nos logs ----------------------------------------------

assert.equal(redactToken('clonando https://x-access-token:segredo@github.com/a/b', 'segredo'), 'clonando https://x-access-token:***@github.com/a/b');
// a forma codificada também tem que sumir, senão o log vaza o token escapado
assert.ok(!redactToken('url: https://x-access-token:ab%2Fc@github.com', 'ab/c').includes('ab%2Fc'));
assert.equal(redactToken('sem token aqui'), 'sem token aqui');

// --- compose gerado ---------------------------------------------------------

const compose = renderGitCompose({
  slug: 'meuapp',
  image: 'velix/meuapp:latest',
  port: 3000,
  env: { NODE_ENV: 'production' },
  volumes: [{ name: 'data', containerPath: '/data' }],
  proxyNetwork: 'velix-proxy',
});

assert.ok(compose.includes('image: velix/meuapp:latest'));
assert.ok(compose.includes('container_name: meuapp_app'));
assert.ok(compose.includes("NODE_ENV: 'production'"));
assert.ok(compose.includes('- meuapp_data:/data'));
assert.ok(compose.includes('external: true'));

// valor com aspa simples não pode encerrar a string e injetar YAML
const injected = renderGitCompose({
  slug: 'x',
  image: 'i',
  port: 80,
  env: { EVIL: "a'\nprivileged: true" },
  volumes: [],
  proxyNetwork: 'n',
});
assert.ok(!/^\s*privileged: true$/m.test(injected), 'valor de env conseguiu injetar chave no compose');

console.log('git-source.util self-check OK');
