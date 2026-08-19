/**
 * Self-check das funções puras do catálogo — sem framework, roda com:
 *   npx ts-node src/catalog/catalog.util.spec.ts
 */
import assert from 'node:assert';
import {
  renderCompose,
  renderServiceEnvFiles,
  interpolate,
  generateSecretValue,
  resolveSecrets,
  resolveVariables,
  allVariables,
  servicePorts,
  validateManifest,
  scanSecurityRisks,
  highestRiskLevel,
  primaryContainerName,
  requiredServices,
  optionalServices,
  resolveIncludedServices,
  resolvedDatabaseName,
  type VelixManifest,
} from './catalog.util';
import { uptimeKumaManifest } from './manifests/uptime-kuma';
import { QUICK_MANIFESTS } from './manifests/quick-apps';
import { immichManifest } from './manifests/immich';
import { mysqlManifest } from './manifests/mysql';
import { mariadbManifest } from './manifests/mariadb';
import { ghostManifest } from './manifests/ghost';
import { zabbixManifest } from './manifests/zabbix';
import { wgEasyManifest } from './manifests/wg-easy';

// validação: o manifesto oficial é válido
assert.equal(validateManifest(uptimeKumaManifest).ok, true);

// validação: primaryService que não existe é erro
const badManifest: VelixManifest = { ...uptimeKumaManifest, primaryService: 'nao-existe' };
const badResult = validateManifest(badManifest);
assert.equal(badResult.ok, false);
assert.ok(badResult.errors.some((e) => e.includes('primaryService')));

// compose renderizado: nome do container prefixado pelo slug do app, volume nomeado, rede externa
const compose = renderCompose(uptimeKumaManifest, 'meuapp');
assert.ok(compose.includes('container_name: meuapp_app'));
assert.ok(compose.includes('image: louislam/uptime-kuma:1.23.16'));
assert.ok(compose.includes('meuapp_data:/app/data'));
assert.ok(compose.includes('meuapp_data:\n'));
assert.ok(compose.includes('velix-proxy:\n    external: true'));

// volumeNameOverrides: pino o volume novo no volume real já existente (nome
// resolvido do projeto ANTIGO) em vez de deixar nascer um vazio com o nome
// derivado do slug novo — usado por moveDeployment (mover serviço entre projetos).
const composeWithOverride = renderCompose(uptimeKumaManifest, 'projetonovo', {}, [], {}, { data: 'projetoantigo_projetoantigo_data' });
assert.ok(composeWithOverride.includes('projetonovo_data:\n    name: projetoantigo_projetoantigo_data'), 'volume novo aponta pro nome real do volume antigo');
assert.ok(composeWithOverride.includes('projetonovo_data:/app/data'), 'o mount dentro do serviço continua usando a chave do projeto novo, só o top-level ganha o pin');
// sem override, comportamento continua idêntico a antes (não regressão) —
// só container_name: existe, nunca um `name:` de volume pinado
assert.ok(!renderCompose(uptimeKumaManifest, 'meuapp').includes('\n    name: '));

// nome do container primário bate com o que o compose realmente gera
assert.equal(primaryContainerName(uptimeKumaManifest, 'meuapp'), 'meuapp_app');

// publicar porta: só quando pedido (hostPorts), na porta recomendada do serviço
const withoutPort = renderCompose(uptimeKumaManifest, 'meuapp', {}, []);
assert.ok(!withoutPort.includes('ports:'), 'sem hostPorts, não publica porta nenhuma');
const withPort = renderCompose(uptimeKumaManifest, 'meuapp', {}, [], { app: 13001 });
assert.ok(withPort.includes('ports:\n      - "13001:3001"'), 'porta do host mapeada pra porta recomendada do container');

// segurança: manifesto oficial não deve disparar nenhum achado
assert.deepEqual(scanSecurityRisks(uptimeKumaManifest), []);

// segurança: sinalizadores conhecidos são detectados e classificados
const riskyManifest: VelixManifest = {
  ...uptimeKumaManifest,
  services: [{ name: 'app', image: 'algum/imagem', privileged: true, networkMode: 'host', dockerSocket: true }],
};
const findings = scanSecurityRisks(riskyManifest);
assert.equal(findings.length, 4); // blocked (privileged) + high (host) + medium (docker.sock) + low (tag sem versão)
assert.equal(highestRiskLevel(findings), 'blocked');
assert.equal(highestRiskLevel([]), 'low');

// interpolação: segredo e nome de serviço são resolvidos, texto sem placeholder passa direto
assert.equal(interpolate('senha={{secret:DB_PASS}}', 'meuapp', { DB_PASS: 'xyz123' }), 'senha=xyz123');
assert.equal(interpolate('host={{service:db}}', 'meuapp', {}), 'host=meuapp_db');
assert.equal(interpolate('sem-placeholder', 'meuapp', {}), 'sem-placeholder');
assert.equal(interpolate('{{secret:FALTANDO}}', 'meuapp', {}), '');
assert.equal(interpolate('user={{var:ADMIN_USER}}', 'meuapp', {}, { ADMIN_USER: 'root' }), 'user=root');
assert.equal(interpolate('user={{var:FALTANDO}}', 'meuapp', {}), 'user=');

// resolveVariables: valor do usuário tem prioridade, senão cai no default do manifesto
const withVariables: VelixManifest = {
  ...uptimeKumaManifest,
  services: [
    {
      name: 'app',
      image: 'x:1',
      variables: [{ key: 'ADMIN_USER', label: 'Usuário', type: 'text', default: 'admin' }],
    },
  ],
};
assert.deepEqual(resolveVariables(withVariables, { ADMIN_USER: 'jhonata' }), { ADMIN_USER: 'jhonata' });
assert.deepEqual(resolveVariables(withVariables, {}), { ADMIN_USER: 'admin' });
assert.deepEqual(
  allVariables(withVariables).map((v) => v.key),
  ['ADMIN_USER'],
);

// geração de segredo: tamanho correto, dois valores gerados nunca são iguais
const secretA = generateSecretValue();
const secretB = generateSecretValue();
assert.ok(secretA.length > 0);
assert.notEqual(secretA, secretB);
assert.equal(generateSecretValue(8).length > 0, true);

// resolveSecrets: uma chave por segredo declarado
const withSecrets: VelixManifest = {
  ...uptimeKumaManifest,
  secrets: [{ key: 'ROOT_PASSWORD' }, { key: 'APP_PASSWORD' }],
  services: [{ name: 'db', image: 'mysql:8', environment: { MYSQL_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}' } }],
};
const resolved = resolveSecrets(withSecrets);
assert.deepEqual(Object.keys(resolved).sort(), ['APP_PASSWORD', 'ROOT_PASSWORD']);

// resolveSecrets: valor digitado pelo usuário tem prioridade sobre o gerado
// automático (ex.: senha root customizada na hora de criar um banco) —
// vazio ou ausente continua gerando, chave desconhecida é ignorada
assert.equal(resolveSecrets(withSecrets, { ROOT_PASSWORD: 'minhaSenha123' }).ROOT_PASSWORD, 'minhaSenha123');
assert.notEqual(resolveSecrets(withSecrets, { ROOT_PASSWORD: '' }).ROOT_PASSWORD, '');
assert.ok(resolveSecrets(withSecrets, { ROOT_PASSWORD: '  ' }).ROOT_PASSWORD.trim().length > 0, 'senha só com espaço não conta como escolhida — gera automático');
assert.equal(Object.keys(resolveSecrets(withSecrets, { CHAVE_QUE_NAO_EXISTE: 'x' })).length, 2);

// manifestos oficiais de MySQL/MariaDB continuam válidos com o usuário de
// app opcional (APP_USER/APP_PASSWORD) — pego de propósito fora do laço de
// QUICK_MANIFESTS mais abaixo, que não inclui os manifestos "oficiais"
assert.equal(validateManifest(mysqlManifest).ok, true);
assert.equal(validateManifest(mariadbManifest).ok, true);

// Zabbix: 3 serviços (db/server/web) com dependsOn encadeado — confirma que
// as referências entre eles (nome do serviço, primaryService) batem.
assert.equal(validateManifest(zabbixManifest).ok, true, JSON.stringify(validateManifest(zabbixManifest).errors));
assert.equal(highestRiskLevel(scanSecurityRisks(zabbixManifest)), 'low', 'sem privileged/host network/docker socket');
// usuário de app em branco: MYSQL_USER/MARIADB_USER vazios (a imagem oficial
// pula a criação do usuário extra quando isso acontece)
const mysqlComposeNoAppUser = renderCompose(mysqlManifest, 'meuapp');
assert.ok(mysqlComposeNoAppUser.includes('env_file:\n      - ./secrets/db.env'), 'segredos do MySQL continuam via env_file, não inline');

// compose com segredos: nenhum valor sensível inline, usa env_file
const composeWithSecrets = renderCompose(withSecrets, 'meuapp');
assert.ok(!composeWithSecrets.includes(resolved.ROOT_PASSWORD));
assert.ok(composeWithSecrets.includes('env_file:\n      - ./secrets/db.env'));
assert.ok(!composeWithSecrets.includes('environment:'));

// arquivo de env real (fora do compose salvo) tem o valor resolvido
const envFiles = renderServiceEnvFiles(withSecrets, 'meuapp', resolved);
assert.equal(envFiles.db, `MYSQL_ROOT_PASSWORD=${resolved.ROOT_PASSWORD}\n`);

// arquivo de env real com segredo + variável misturados (padrão do Grafana): ambos resolvidos
const withSecretAndVariable: VelixManifest = {
  ...uptimeKumaManifest,
  secrets: [{ key: 'ADMIN_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'x:1',
      environment: { GF_SECURITY_ADMIN_USER: '{{var:ADMIN_USER}}', GF_SECURITY_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}' },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário', type: 'text', default: 'admin' }],
    },
  ],
};
const mixedSecrets = resolveSecrets(withSecretAndVariable);
const mixedVariables = resolveVariables(withSecretAndVariable, { ADMIN_USER: 'root' });
const mixedEnvFiles = renderServiceEnvFiles(withSecretAndVariable, 'meuapp', mixedSecrets, mixedVariables);
assert.equal(mixedEnvFiles.app, `GF_SECURITY_ADMIN_USER=root\nGF_SECURITY_ADMIN_PASSWORD=${mixedSecrets.ADMIN_PASSWORD}\n`);

// manifesto sem segredos: renderServiceEnvFiles não gera nada
assert.deepEqual(renderServiceEnvFiles(uptimeKumaManifest, 'meuapp', {}), {});

// portas do serviço: recomendada vem primeiro
const withPorts: VelixManifest = {
  ...uptimeKumaManifest,
  services: [{ name: 'app', image: 'x:1', ports: [{ port: 3000 }, { port: 3001, recommended: true }] }],
};
assert.deepEqual(
  servicePorts(withPorts, 'app').map((p) => p.port),
  [3001, 3000],
);
assert.deepEqual(servicePorts(withPorts, 'nao-existe'), []);

// componentes: obrigatório sempre incluso, opcional só quando selecionado
const withOptional: VelixManifest = {
  ...uptimeKumaManifest,
  services: [
    { name: 'app', image: 'x:1' },
    { name: 'db', image: 'postgres:16' },
    { name: 'cache', image: 'redis:7', optional: true },
    { name: 'onlyoffice', image: 'onlyoffice/documentserver:8', optional: true, dependsOn: ['cache'] },
  ],
};
assert.deepEqual(requiredServices(withOptional).map((s) => s.name), ['app', 'db']);
assert.deepEqual(optionalServices(withOptional).map((s) => s.name), ['cache', 'onlyoffice']);

// sem seleção: só obrigatórios
assert.deepEqual(
  resolveIncludedServices(withOptional).map((s) => s.name).sort(),
  ['app', 'db'],
);
// selecionando só onlyoffice: cache entra junto (dependência em cascata)
assert.deepEqual(
  resolveIncludedServices(withOptional, ['onlyoffice']).map((s) => s.name).sort(),
  ['app', 'cache', 'db', 'onlyoffice'],
);

// compose respeita a seleção: onlyoffice fora quando não selecionado
const composeWithoutOptional = renderCompose(withOptional, 'meuapp');
assert.ok(!composeWithoutOptional.includes('onlyoffice'));
assert.ok(!composeWithoutOptional.includes('cache'));

// compose com onlyoffice selecionado: cache entra (dependência) e depends_on aparece
const composeWithOptional = renderCompose(withOptional, 'meuapp', {}, ['onlyoffice']);
assert.ok(composeWithOptional.includes('onlyoffice:'));
assert.ok(composeWithOptional.includes('cache:'));
assert.ok(composeWithOptional.includes('depends_on:\n      - cache'));

// volume com o mesmo nome em dois serviços vira UM volume top-level só (não duplicado)
const sharedVolume: VelixManifest = {
  ...uptimeKumaManifest,
  services: [
    { name: 'app', image: 'x:1', volumes: [{ name: 'shared', containerPath: '/data' }] },
    { name: 'cron', image: 'x:1', command: '/cron.sh', volumes: [{ name: 'shared', containerPath: '/data' }] },
  ],
};
const sharedCompose = renderCompose(sharedVolume, 'meuapp');
assert.equal((sharedCompose.match(/meuapp_shared:/g) ?? []).length, 3); // 2x no volumes: dos serviços + 1x no bloco top-level

// validação: dependsOn apontando pra serviço inexistente é erro
const badDeps: VelixManifest = { ...uptimeKumaManifest, services: [{ name: 'app', image: 'x:1', dependsOn: ['fantasma'] }] };
assert.equal(validateManifest(badDeps).ok, false);

// validação: todo manifesto do catálogo passa na validação estrutural, tem slug
// único e fixa a versão da imagem (a tabela de quick-apps é gerada, então um
// erro de digitação lá vira 100 apps quebrados de uma vez)
const catalog = [...QUICK_MANIFESTS, immichManifest];
const catalogSlugs = catalog.map((m) => m.slug);
assert.equal(new Set(catalogSlugs).size, catalogSlugs.length, 'slug duplicado no catálogo');
for (const manifest of catalog) {
  const result = validateManifest(manifest);
  assert.equal(result.ok, true, `${manifest.slug}: ${result.errors.join('; ')}`);
  assert.ok(manifest.services.some((s) => s.ports?.length), `${manifest.slug} sem porta declarada`);
  for (const service of manifest.services) {
    assert.ok(/:[^:]+$/.test(service.image), `${manifest.slug}: imagem "${service.image}" sem tag`);
    assert.ok(!service.image.endsWith(':latest'), `${manifest.slug}: imagem sem versão fixa`);
  }
}

// resolvedDatabaseName: banco fixo no manifesto (Ghost) — nunca cai no fallback 'app'
assert.equal(resolvedDatabaseName(ghostManifest, 'db', {}), 'ghost');

// resolvedDatabaseName: banco vem de variável do usuário (manifesto genérico do MySQL)
assert.equal(resolvedDatabaseName(mysqlManifest, 'mysql', { DATABASE_NAME: 'minhaapp' }), 'minhaapp');
assert.equal(resolvedDatabaseName(mysqlManifest, 'mysql', {}), 'app'); // sem valor: cai no default da variável

// resolvedDatabaseName: sem manifesto (implantação via Git) ou serviço desconhecido — fallback final
assert.equal(resolvedDatabaseName(null, 'db', {}), 'app');
assert.equal(resolvedDatabaseName(ghostManifest, 'servico-inexistente', {}), 'app');

// wg-easy: NET_ADMIN é permitido (não bloqueia o deploy) e vira cap_add no
// compose; sysctls também é renderizado; a porta recomendada é a UDP
// (51820, dados da VPN), publicada com sufixo /udp — TCP sem sufixo
// publicaria a porta certa como protocolo errado, e nenhum pacote chegaria.
const wgEasyRisk = highestRiskLevel(scanSecurityRisks(wgEasyManifest));
assert.notEqual(wgEasyRisk, 'blocked', 'wg-easy não deveria ser bloqueado só por pedir NET_ADMIN');
const wgEasyCompose = renderCompose(wgEasyManifest, 'meuvpn');
assert.ok(wgEasyCompose.includes('cap_add:\n    - NET_ADMIN'), 'cap_add não renderizado');
assert.ok(wgEasyCompose.includes('sysctls:\n    - net.ipv4.ip_forward=1'), 'sysctls não renderizado');
const wgEasyWithPort = renderCompose(wgEasyManifest, 'meuvpn', {}, [], { app: 51820 });
assert.ok(wgEasyWithPort.includes('"51820:51820/udp"'), 'porta recomendada deveria publicar como UDP');

console.log(`catalog.util self-check OK (${catalog.length} manifestos novos validados)`);
