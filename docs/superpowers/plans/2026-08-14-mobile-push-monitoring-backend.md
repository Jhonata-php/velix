# Monitoramento em tempo real + push notifications (backend) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada servidor cadastrado no Velix passa a ser monitorado continuamente (CPU%, memória%, temperatura quando disponível, eventos de container) via SSH, e cada usuário recebe push notification (Firebase) no celular quando os próprios limites configurados são cruzados ou um container para/reinicia — base pros dois apps móveis nativos que vêm depois.

**Architecture:** um `ServerWatcher` por servidor mantém duas streams SSH persistentes (reaproveitando `SshService.runCommand` com `onData`/`abortSignal`, o mesmo mecanismo já usado pra `docker logs -f`): uma pra `docker events` e outra pra uma amostragem periódica de CPU/memória/temperatura. Cada amostra/evento passa por um avaliador que resolve o limite configurado por usuário (global + override por servidor) e dispara push via Firebase Cloud Messaging, reaproveitando o `AlertState` que já existe pro padrão abre/resolve.

**Tech Stack:** NestJS + Prisma (Postgres) já usados na API; `ssh2` (já dependência) pro streaming; `firebase-admin` (dependência nova) pro push.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-14-mobile-push-monitoring-backend-design.md` — qualquer dúvida de comportamento não coberta neste plano, essa é a fonte.
- Todo texto voltado a humano (comentários, mensagens de erro, títulos de notificação) em português, seguindo o padrão do resto do `apps/api`.
- Migração Prisma é SQL escrito à mão em `prisma/migrations/<timestamp>_<nome>/migration.sql` + `schema.prisma` editado a mão — este repo não roda `prisma migrate dev` interativo (ver migrações existentes em `prisma/migrations/`).
- Testes deste repo não usam Jest/Mocha: funções puras ganham um `*.spec.ts` no estilo `assert` do Node, rodado com `npx ts-node <arquivo>` (ver `src/applications/applications.util.spec.ts` como referência). Serviços que só orquestram Prisma/DI (sem lógica pura relevante) não ganham spec dedicado — é o padrão já usado por `alerts.service.ts`, `database-console.service.ts`, etc.
- Todo controller novo usa `@UseGuards(JwtAuthGuard)` (e `RolesGuard`/`@MinRole` só se a rota exigir um papel mínimo) — nenhuma rota nova fica sem autenticação.
- Comandos remotos (SSH) neste plano usam concatenação de string comum (aspas simples/duplas de shell dentro de string JS normal) em vez de template literals com crase, pra não colidir com a sintaxe `${...}` de interpolação do JavaScript.

---

### Task 1: Migração Prisma — `DeviceToken`, `AlertThresholdPreference`, colunas novas em `ServerMetricSample`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260814140000_mobile_push_monitoring/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `DeviceToken` e `AlertThresholdPreference`, e os campos `ServerMetricSample.cpuPercent`/`ServerMetricSample.temperatureCelsius` — usados por todas as tasks seguintes via `this.prisma.deviceToken`, `this.prisma.alertThresholdPreference`.

- [ ] **Step 1: Editar `schema.prisma` — adicionar os dois modelos novos**

Logo depois do modelo `ServerMetricSample` (linha 612-623 atual, ver `@@index([serverId, capturedAt])` como âncora), adicionar:

```prisma
model DeviceToken {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform   String
  fcmToken   String   @unique
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([userId])
}

model AlertThresholdPreference {
  id                 String   @id @default(uuid())
  userId             String
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  serverId           String?
  server             Server?  @relation(fields: [serverId], references: [id], onDelete: Cascade)

  cpuPercent         Int?
  memoryPercent      Int?
  temperatureCelsius Int?
  dockerScope        String   @default("all")
  dockerEnabled      Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, serverId])
}
```

E adicionar as duas colunas novas dentro do `model ServerMetricSample` existente, depois de `diskPercent`:

```prisma
  diskPercent Float?
  cpuPercent  Float?
  temperatureCelsius Float?
  capturedAt  DateTime @default(now())
```

- [ ] **Step 2: Adicionar as relações inversas em `User` e `Server`**

Em `model User` (perto de `databaseQueryLogs DatabaseQueryLog[]`), adicionar:

```prisma
  deviceTokens      DeviceToken[]
  alertThresholds   AlertThresholdPreference[]
```

Em `model Server` (perto de `applications  Application[]`), adicionar:

```prisma
  alertThresholdOverrides AlertThresholdPreference[]
```

- [ ] **Step 3: Escrever a migração SQL a mão**

Criar `apps/api/prisma/migrations/20260814140000_mobile_push_monitoring/migration.sql`:

```sql
-- Push notification (token de dispositivo) e limites de alerta configuráveis
-- por pessoa (CPU/memória/temperatura/eventos de container), pro
-- monitoramento em tempo real usado pelos apps móveis. Ver
-- docs/superpowers/specs/2026-08-14-mobile-push-monitoring-backend-design.md.

CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceToken_fcmToken_key" ON "DeviceToken"("fcmToken");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AlertThresholdPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT,
    "cpuPercent" INTEGER,
    "memoryPercent" INTEGER,
    "temperatureCelsius" INTEGER,
    "dockerScope" TEXT NOT NULL DEFAULT 'all',
    "dockerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertThresholdPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertThresholdPreference_userId_serverId_key" ON "AlertThresholdPreference"("userId", "serverId");

ALTER TABLE "AlertThresholdPreference" ADD CONSTRAINT "AlertThresholdPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertThresholdPreference" ADD CONSTRAINT "AlertThresholdPreference_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServerMetricSample" ADD COLUMN "cpuPercent" DOUBLE PRECISION;
ALTER TABLE "ServerMetricSample" ADD COLUMN "temperatureCelsius" DOUBLE PRECISION;
```

- [ ] **Step 4: Gerar o Prisma Client e validar o schema**

Run: `cd apps/api && npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erro. Isso também valida que `schema.prisma` está sintaticamente correto e bate com a migração.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260814140000_mobile_push_monitoring
git commit -m "Migração: DeviceToken e AlertThresholdPreference pro monitoramento móvel"
```

---

### Task 2: `metrics-sample.util.ts` — comando e parser da amostragem contínua

**Files:**
- Create: `apps/api/src/monitoring/metrics-sample.util.ts`
- Test: `apps/api/src/monitoring/metrics-sample.util.spec.ts`

**Interfaces:**
- Produces: `MONITORING_SAMPLE_COMMAND: string`, `RawSample` interface, `parseSampleLine(line: string): RawSample | null`, `computeCpuPercent(prev: RawSample | null, current: RawSample): number | null`, `computeMemoryPercent(sample: RawSample): number | null` — consumidos por `server-watcher.ts` (Task 6) e `threshold-alert.service.ts` (Task 10).

- [ ] **Step 1: Escrever o teste (falha primeiro — o arquivo de implementação ainda não existe)**

`apps/api/src/monitoring/metrics-sample.util.spec.ts`:

```ts
/**
 * Self-check das funções puras de amostragem contínua — sem framework:
 *   npx ts-node src/monitoring/metrics-sample.util.spec.ts
 */
import assert from 'node:assert';
import { parseSampleLine, computeCpuPercent, computeMemoryPercent, RawSample } from './metrics-sample.util';

// --- parseSampleLine ---------------------------------------------------

const line1 = 'VELIX_SAMPLE cpu_total=1000 cpu_idle=800 mem_total_kb=8000000 mem_avail_kb=4000000 temp_c=45.5';
const sample1 = parseSampleLine(line1);
assert.ok(sample1);
assert.equal(sample1!.cpuTotal, 1000);
assert.equal(sample1!.cpuIdle, 800);
assert.equal(sample1!.memTotalKb, 8000000);
assert.equal(sample1!.memAvailKb, 4000000);
assert.equal(sample1!.temperatureCelsius, 45.5);

// sem sensor de temperatura (campo vazio no shell)
const line2 = 'VELIX_SAMPLE cpu_total=2000 cpu_idle=1900 mem_total_kb=8000000 mem_avail_kb=6000000 temp_c=';
const sample2 = parseSampleLine(line2);
assert.ok(sample2);
assert.equal(sample2!.temperatureCelsius, null);

// linha que não é uma amostra (ex.: ruído do shell) — ignorada
assert.equal(parseSampleLine('bash: sensors: command not found'), null);
assert.equal(parseSampleLine(''), null);

console.log('parseSampleLine self-check OK');

// --- computeCpuPercent --------------------------------------------------

// sem amostra anterior, não dá pra calcular delta
assert.equal(computeCpuPercent(null, sample1!), null);

const prev: RawSample = { cpuTotal: 1000, cpuIdle: 800, memTotalKb: null, memAvailKb: null, temperatureCelsius: null };
const current: RawSample = { cpuTotal: 1100, cpuIdle: 850, memTotalKb: null, memAvailKb: null, temperatureCelsius: null };
// total avançou 100, idle avançou 50 -> 50% de uso no intervalo
assert.equal(computeCpuPercent(prev, current), 50);

// contador não avançou (amostra repetida) -> sem delta válido
assert.equal(computeCpuPercent(prev, prev), null);

console.log('computeCpuPercent self-check OK');

// --- computeMemoryPercent ------------------------------------------------

assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: 8000000, memAvailKb: 2000000, temperatureCelsius: null }), 75);
assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: null, memAvailKb: 2000000, temperatureCelsius: null }), null);
assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: 0, memAvailKb: 0, temperatureCelsius: null }), null);

console.log('computeMemoryPercent self-check OK');
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (arquivo de implementação não existe)**

Run: `cd apps/api && npx ts-node src/monitoring/metrics-sample.util.spec.ts`
Expected: erro de módulo não encontrado (`Cannot find module './metrics-sample.util'`)

- [ ] **Step 3: Implementar `metrics-sample.util.ts`**

```ts
/**
 * Comando remoto de amostragem contínua do watcher: um loop que reamostra
 * CPU (via delta de contadores de /proc/stat entre execuções do próprio
 * loop — sem sleep extra), memória e temperatura a cada 5s, numa única
 * sessão SSH. O cálculo de CPU% em si fica em `computeCpuPercent` (não no
 * shell), pra poder ser testado sem SSH.
 *
 * `temp_unsupported` é uma variável do próprio shell, guardada entre
 * iterações do loop: na primeira vez que `sensors` não devolve nada, para de
 * tentar pelo resto desta sessão SSH — sem gerar erro nem custo repetido num
 * servidor sem lm-sensors (a maioria dos VPS). Reseta sozinho quando a
 * conexão cai e o watcher reconecta (nova sessão, novo shell).
 */
export const MONITORING_SAMPLE_COMMAND = [
  'while true; do',
  '  read -r cpu user nice system idle iowait irq softirq steal rest < /proc/stat',
  "  memtotal=$(awk '/MemTotal/{print $2}' /proc/meminfo)",
  "  memavail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)",
  '  if [ -z "$temp_unsupported" ]; then',
  "    temp=$(sensors -j 2>/dev/null | grep -m1 temp1_input | grep -oE '[0-9]+\\.[0-9]+')",
  '    if [ -z "$temp" ]; then temp_unsupported=1; fi',
  '  else',
  '    temp=""',
  '  fi',
  '  echo "VELIX_SAMPLE cpu_total=$((user+nice+system+idle+iowait+irq+softirq+steal)) cpu_idle=$idle mem_total_kb=$memtotal mem_avail_kb=$memavail temp_c=$temp"',
  '  sleep 5',
  'done',
].join('\n');

export interface RawSample {
  cpuTotal: number;
  cpuIdle: number;
  memTotalKb: number | null;
  memAvailKb: number | null;
  temperatureCelsius: number | null;
}

const FIELD_RE = /(\w+)=(\S*)/g;

export function parseSampleLine(line: string): RawSample | null {
  if (!line.startsWith('VELIX_SAMPLE ')) return null;

  const fields: Record<string, string> = {};
  for (const match of line.matchAll(FIELD_RE)) {
    fields[match[1]] = match[2];
  }

  const cpuTotal = Number(fields.cpu_total);
  const cpuIdle = Number(fields.cpu_idle);
  if (!Number.isFinite(cpuTotal) || !Number.isFinite(cpuIdle)) return null;

  const memTotalKb = Number(fields.mem_total_kb);
  const memAvailKb = Number(fields.mem_avail_kb);
  const temp = Number(fields.temp_c);

  return {
    cpuTotal,
    cpuIdle,
    memTotalKb: Number.isFinite(memTotalKb) ? memTotalKb : null,
    memAvailKb: Number.isFinite(memAvailKb) ? memAvailKb : null,
    temperatureCelsius: Number.isFinite(temp) ? temp : null,
  };
}

/** CPU% precisa de duas amostras (contadores acumulados desde o boot). */
export function computeCpuPercent(prev: RawSample | null, current: RawSample): number | null {
  if (!prev) return null;
  const totalDelta = current.cpuTotal - prev.cpuTotal;
  const idleDelta = current.cpuIdle - prev.cpuIdle;
  if (totalDelta <= 0) return null;
  return Math.round((100 * (totalDelta - idleDelta)) / totalDelta);
}

export function computeMemoryPercent(sample: RawSample): number | null {
  if (sample.memTotalKb === null || sample.memAvailKb === null || sample.memTotalKb === 0) return null;
  return Math.round((100 * (sample.memTotalKb - sample.memAvailKb)) / sample.memTotalKb);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd apps/api && npx ts-node src/monitoring/metrics-sample.util.spec.ts`
Expected: as três linhas `... self-check OK` impressas, sem erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/monitoring/metrics-sample.util.ts apps/api/src/monitoring/metrics-sample.util.spec.ts
git commit -m "Amostragem contínua de CPU/memória/temperatura: comando remoto e parser"
```

---

### Task 3: `docker-event.util.ts` — comando e classificador de eventos Docker

**Files:**
- Create: `apps/api/src/monitoring/docker-event.util.ts`
- Test: `apps/api/src/monitoring/docker-event.util.spec.ts`

**Interfaces:**
- Produces: `DOCKER_EVENTS_COMMAND: string`, `DockerEventKind` ('stopped'|'crashed'|'restarted'), `NormalizedDockerEvent` interface, `parseDockerEventLine(line: string): NormalizedDockerEvent | null` — consumidos por `server-watcher.ts` (Task 6) e `threshold-alert.service.ts` (Task 10).

- [ ] **Step 1: Escrever o teste**

`apps/api/src/monitoring/docker-event.util.spec.ts`:

```ts
/**
 * Self-check do classificador de eventos Docker — sem framework:
 *   npx ts-node src/monitoring/docker-event.util.spec.ts
 */
import assert from 'node:assert';
import { parseDockerEventLine } from './docker-event.util';

// container parou de propósito (docker stop / exit 0)
const stopped = parseDockerEventLine(
  JSON.stringify({
    Action: 'die',
    Actor: { ID: 'abc123', Attributes: { name: 'meuapp_web', exitCode: '0' } },
  }),
);
assert.deepEqual(stopped, { kind: 'stopped', containerId: 'abc123', containerName: 'meuapp_web', exitCode: 0 });

// container travou (exit code != 0)
const crashed = parseDockerEventLine(
  JSON.stringify({
    Action: 'die',
    Actor: { ID: 'def456', Attributes: { name: 'meuapp_worker', exitCode: '137' } },
  }),
);
assert.deepEqual(crashed, { kind: 'crashed', containerId: 'def456', containerName: 'meuapp_worker', exitCode: 137 });

// reinício explícito (docker restart / política de restart)
const restarted = parseDockerEventLine(
  JSON.stringify({ Action: 'restart', Actor: { ID: 'ghi789', Attributes: { name: 'meuapp_db' } } }),
);
assert.deepEqual(restarted, { kind: 'restarted', containerId: 'ghi789', containerName: 'meuapp_db', exitCode: null });

// ação irrelevante (create, start isolado, destroy, etc.) — ignorada
assert.equal(
  parseDockerEventLine(JSON.stringify({ Action: 'create', Actor: { ID: 'x', Attributes: {} } })),
  null,
);

// sem nome do container — cai pro id
const noName = parseDockerEventLine(
  JSON.stringify({ Action: 'die', Actor: { ID: 'noname1', Attributes: { exitCode: '0' } } }),
);
assert.equal(noName!.containerName, 'noname1');

// linha malformada / vazia
assert.equal(parseDockerEventLine('não é json'), null);
assert.equal(parseDockerEventLine(''), null);
assert.equal(parseDockerEventLine('   '), null);

console.log('docker-event.util self-check OK');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/monitoring/docker-event.util.spec.ts`
Expected: `Cannot find module './docker-event.util'`

- [ ] **Step 3: Implementar `docker-event.util.ts`**

```ts
/**
 * `--filter type=container` restringe o stream a eventos de container (sem
 * isso `docker events` também manda eventos de rede/volume/imagem, que não
 * interessam aqui). O uso de `sudo` casa com o resto dos comandos Docker do
 * Velix (ver `dockerStatus`/`streamContainerLogs` em servers.service.ts).
 */
export const DOCKER_EVENTS_COMMAND = "sudo docker events --format '{{json .}}' --filter type=container";

export type DockerEventKind = 'stopped' | 'crashed' | 'restarted';

export interface NormalizedDockerEvent {
  kind: DockerEventKind;
  containerId: string;
  containerName: string;
  exitCode: number | null;
}

interface RawDockerEvent {
  Action?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
}

/**
 * `die` com exitCode 0 é parada limpa (`docker stop` ou saída normal do
 * processo) — tratada como "stopped". Qualquer outro código é "crashed".
 * `restart` é o evento que o Docker emite tanto pra `docker restart` manual
 * quanto pra política de restart automático — os dois contam como
 * "reiniciou" pra fins de alerta, sem distinguir a causa.
 */
export function parseDockerEventLine(line: string): NormalizedDockerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: RawDockerEvent;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const containerId = raw.Actor?.ID ?? '';
  if (!containerId) return null;
  const containerName = raw.Actor?.Attributes?.name ?? containerId;

  if (raw.Action === 'die') {
    const exitCode = Number(raw.Actor?.Attributes?.exitCode ?? '0');
    return {
      kind: exitCode === 0 ? 'stopped' : 'crashed',
      containerId,
      containerName,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
    };
  }

  if (raw.Action === 'restart') {
    return { kind: 'restarted', containerId, containerName, exitCode: null };
  }

  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/monitoring/docker-event.util.spec.ts`
Expected: `docker-event.util self-check OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/monitoring/docker-event.util.ts apps/api/src/monitoring/docker-event.util.spec.ts
git commit -m "Classificador de eventos Docker: parou/travou/reiniciou"
```

---

### Task 4: `threshold-resolver.util.ts` — hierarquia servidor → global → desabilitado

**Files:**
- Create: `apps/api/src/monitoring/threshold-resolver.util.ts`
- Test: `apps/api/src/monitoring/threshold-resolver.util.spec.ts`

**Interfaces:**
- Produces: `ThresholdPreferenceRow` interface, `ResolvedThreshold` interface, `resolveThresholdsForServer(rows: ThresholdPreferenceRow[], serverId: string): ResolvedThreshold[]` — consumido por `threshold-alert.service.ts` (Task 10).

- [ ] **Step 1: Escrever o teste**

`apps/api/src/monitoring/threshold-resolver.util.spec.ts`:

```ts
/**
 * Self-check da resolução de limite efetivo (servidor > global > nenhum) —
 * sem framework: npx ts-node src/monitoring/threshold-resolver.util.spec.ts
 */
import assert from 'node:assert';
import { resolveThresholdsForServer, ThresholdPreferenceRow } from './threshold-resolver.util';

function row(partial: Partial<ThresholdPreferenceRow> & { userId: string }): ThresholdPreferenceRow {
  return {
    serverId: null,
    cpuPercent: null,
    memoryPercent: null,
    temperatureCelsius: null,
    dockerScope: 'all',
    dockerEnabled: true,
    ...partial,
  };
}

// usuário só com preferência global -> usa a global
const onlyGlobal = [row({ userId: 'u1', cpuPercent: 80 })];
const resolved1 = resolveThresholdsForServer(onlyGlobal, 'srv-1');
assert.equal(resolved1.length, 1);
assert.equal(resolved1[0].cpuPercent, 80);

// usuário com global E override pro servidor -> override vence
const globalAndOverride = [
  row({ userId: 'u2', cpuPercent: 80 }),
  row({ userId: 'u2', serverId: 'srv-1', cpuPercent: 95 }),
];
const resolved2 = resolveThresholdsForServer(globalAndOverride, 'srv-1');
assert.equal(resolved2.length, 1);
assert.equal(resolved2[0].cpuPercent, 95);

// preferência é de outro servidor -> não entra pro srv-1
const otherServerOnly = [row({ userId: 'u3', serverId: 'srv-2', cpuPercent: 70 })];
assert.equal(resolveThresholdsForServer(otherServerOnly, 'srv-1').length, 0);

// dois usuários independentes, cada um com sua própria resolução
const mixed = [
  row({ userId: 'u4', cpuPercent: 60 }),
  row({ userId: 'u5', serverId: 'srv-1', memoryPercent: 90 }),
];
const resolvedMixed = resolveThresholdsForServer(mixed, 'srv-1');
assert.equal(resolvedMixed.length, 2);
assert.ok(resolvedMixed.find((r) => r.userId === 'u4' && r.cpuPercent === 60));
assert.ok(resolvedMixed.find((r) => r.userId === 'u5' && r.memoryPercent === 90));

// dockerScope desconhecido cai pro default seguro 'all'
const unknownScope = [row({ userId: 'u6', dockerScope: 'algo-invalido' })];
assert.equal(resolveThresholdsForServer(unknownScope, 'srv-1')[0].dockerScope, 'all');

console.log('threshold-resolver.util self-check OK');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/monitoring/threshold-resolver.util.spec.ts`
Expected: `Cannot find module './threshold-resolver.util'`

- [ ] **Step 3: Implementar `threshold-resolver.util.ts`**

```ts
export interface ThresholdPreferenceRow {
  userId: string;
  serverId: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  dockerScope: string;
  dockerEnabled: boolean;
}

export interface ResolvedThreshold {
  userId: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  dockerScope: 'all' | 'managed_apps';
  dockerEnabled: boolean;
}

/**
 * Pra cada usuário com alguma preferência (global ou deste servidor), decide
 * qual vale: a específica do servidor tem prioridade sobre a global. Usuário
 * sem nenhuma das duas fica de fora do resultado — sem alerta pra ele, sem
 * exigir configuração prévia obrigatória.
 */
export function resolveThresholdsForServer(rows: ThresholdPreferenceRow[], serverId: string): ResolvedThreshold[] {
  const byUser = new Map<string, ThresholdPreferenceRow>();

  for (const row of rows) {
    if (row.serverId !== serverId && row.serverId !== null) continue;
    const existing = byUser.get(row.userId);
    const isServerSpecific = row.serverId === serverId;
    if (!existing || (existing.serverId === null && isServerSpecific)) {
      byUser.set(row.userId, row);
    }
  }

  return [...byUser.values()].map((row) => ({
    userId: row.userId,
    cpuPercent: row.cpuPercent,
    memoryPercent: row.memoryPercent,
    temperatureCelsius: row.temperatureCelsius,
    dockerScope: row.dockerScope === 'managed_apps' ? 'managed_apps' : 'all',
    dockerEnabled: row.dockerEnabled,
  }));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/monitoring/threshold-resolver.util.spec.ts`
Expected: `threshold-resolver.util self-check OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/monitoring/threshold-resolver.util.ts apps/api/src/monitoring/threshold-resolver.util.spec.ts
git commit -m "Resolução de limite efetivo: override por servidor vence o global"
```

---

### Task 5: `backoff.util.ts` — backoff exponencial de reconexão

**Files:**
- Create: `apps/api/src/monitoring/backoff.util.ts`
- Test: `apps/api/src/monitoring/backoff.util.spec.ts`

**Interfaces:**
- Produces: `nextBackoffMs(attempt: number): number` — consumido por `server-watcher.ts` (Task 6).

- [ ] **Step 1: Escrever o teste**

`apps/api/src/monitoring/backoff.util.spec.ts`:

```ts
/**
 * Self-check do backoff de reconexão — sem framework:
 *   npx ts-node src/monitoring/backoff.util.spec.ts
 */
import assert from 'node:assert';
import { nextBackoffMs } from './backoff.util';

assert.equal(nextBackoffMs(1), 5_000);
assert.equal(nextBackoffMs(2), 10_000);
assert.equal(nextBackoffMs(3), 30_000);
assert.equal(nextBackoffMs(4), 60_000);
assert.equal(nextBackoffMs(5), 60_000); // teto
assert.equal(nextBackoffMs(100), 60_000);
assert.equal(nextBackoffMs(0), 5_000);

console.log('backoff.util self-check OK');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/monitoring/backoff.util.spec.ts`
Expected: `Cannot find module './backoff.util'`

- [ ] **Step 3: Implementar `backoff.util.ts`**

```ts
const STEPS_MS = [5_000, 10_000, 30_000, 60_000];

/** Tentativa 1 é a primeira reconexão depois de cair (não a conexão
 * inicial). Teto em 60s pra não deixar de tentar de vez. */
export function nextBackoffMs(attempt: number): number {
  if (attempt <= 0) return STEPS_MS[0];
  const index = Math.min(attempt - 1, STEPS_MS.length - 1);
  return STEPS_MS[index];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/monitoring/backoff.util.spec.ts`
Expected: `backoff.util self-check OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/monitoring/backoff.util.ts apps/api/src/monitoring/backoff.util.spec.ts
git commit -m "Backoff exponencial de reconexão do watcher"
```

---

### Task 6: `server-watcher.ts` — as duas streams SSH persistentes por servidor

**Files:**
- Create: `apps/api/src/monitoring/server-watcher.ts`
- Test: `apps/api/src/monitoring/server-watcher.spec.ts`

**Interfaces:**
- Consumes: `SshConnectOptions` (de `../ssh/ssh.service`), `MONITORING_SAMPLE_COMMAND`/`parseSampleLine` (Task 2), `DOCKER_EVENTS_COMMAND`/`parseDockerEventLine` (Task 3), `nextBackoffMs` (Task 5).
- Produces: classe `ServerWatcher` com `start()`/`stop()`, callbacks `onSample: (sample: RawSample) => void` e `onDockerEvent: (event: NormalizedDockerEvent) => void` passados no construtor — consumida por `monitoring.service.ts` (Task 11).

- [ ] **Step 1: Escrever o teste com uma implementação fake de SSH**

`apps/api/src/monitoring/server-watcher.spec.ts`:

```ts
/**
 * Self-check do ServerWatcher com uma implementação fake de SSH (sem
 * conexão real) — npx ts-node src/monitoring/server-watcher.spec.ts
 */
import assert from 'node:assert';
import { ServerWatcher, ServerWatcherSsh } from './server-watcher';
import { RawSample } from './metrics-sample.util';
import { NormalizedDockerEvent } from './docker-event.util';

// --- reconecta depois que a conexão cai, respeita stop() ------------------

async function testReconnectAndStop() {
  let callCount = 0;
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, _command, _timeout, onData, _signal) {
      callCount++;
      if (callCount === 1) {
        // primeira "conexão": manda uma linha e cai (simula queda de SSH)
        onData?.('VELIX_SAMPLE cpu_total=100 cpu_idle=80 mem_total_kb=1000 mem_avail_kb=500 temp_c=40\n', false);
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const samples: RawSample[] = [];
  const watcher = new ServerWatcher(
    'srv-1',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    (sample) => samples.push(sample),
    () => {},
    async () => {}, // sleepFn sem espera real, pra não travar o teste
  );

  watcher.start();
  // dá tempo pro microtask do runLoop rodar algumas iterações
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();
  await new Promise((r) => setTimeout(r, 20));
  const countAfterStop = callCount;
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(samples.length >= 1, true, 'deveria ter recebido ao menos uma amostra');
  assert.equal(callCount, countAfterStop, 'não deveria reconectar depois de stop()');
  assert.equal(callCount >= 2, true, 'deveria ter tentado reconectar ao menos uma vez antes do stop');
}

// --- linha partida entre dois chunks é remontada antes de parsear ---------

async function testPartialLineBuffering() {
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, _command, _timeout, onData) {
      onData?.('VELIX_SAMPLE cpu_total=10', false);
      onData?.('0 cpu_idle=80 mem_total_kb=1000 mem_avail_kb=500 temp_c=40\n', false);
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const samples: RawSample[] = [];
  const watcher = new ServerWatcher(
    'srv-2',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    (sample) => samples.push(sample),
    () => {},
    async () => {},
  );

  watcher.start();
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();

  assert.equal(samples.length, 1);
  assert.equal(samples[0].cpuTotal, 100);
}

// --- eventos docker chegam pelo callback certo ------------------------------

async function testDockerEventCallback() {
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, command, _timeout, onData) {
      if (command.includes('docker events')) {
        onData?.(JSON.stringify({ Action: 'restart', Actor: { ID: 'c1', Attributes: { name: 'app' } } }) + '\n', false);
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const events: NormalizedDockerEvent[] = [];
  const watcher = new ServerWatcher(
    'srv-3',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    () => {},
    (event) => events.push(event),
    async () => {},
  );

  watcher.start();
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();

  assert.equal(events.length >= 1, true);
  assert.equal(events[0].kind, 'restarted');
}

async function main() {
  await testReconnectAndStop();
  await testPartialLineBuffering();
  await testDockerEventCallback();
  console.log('server-watcher self-check OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/monitoring/server-watcher.spec.ts`
Expected: `Cannot find module './server-watcher'`

- [ ] **Step 3: Implementar `server-watcher.ts`**

```ts
import { SshConnectOptions } from '../ssh/ssh.service';
import { MONITORING_SAMPLE_COMMAND, parseSampleLine, RawSample } from './metrics-sample.util';
import { DOCKER_EVENTS_COMMAND, parseDockerEventLine, NormalizedDockerEvent } from './docker-event.util';
import { nextBackoffMs } from './backoff.util';

/** Só o que o watcher usa de SshService — deixa o teste injetar um fake sem
 * precisar de uma conexão SSH de verdade. */
export interface ServerWatcherSsh {
  runCommand(
    options: SshConnectOptions,
    command: string,
    timeoutMs: number,
    onData?: (chunk: string, isError: boolean) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; message?: string }>;
}

const LOOP_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type StreamKind = 'sample' | 'events';

/**
 * Mantém duas streams SSH vivas pra um servidor: amostragem de métricas e
 * eventos de container. Se a conexão cair (rede, servidor reiniciou, etc.),
 * reconecta sozinho com backoff exponencial até `stop()` ser chamado.
 */
export class ServerWatcher {
  private stopped = false;
  private sampleAttempt = 0;
  private eventsAttempt = 0;
  private sampleBuffer = '';
  private eventsBuffer = '';

  constructor(
    private readonly serverId: string,
    private readonly options: SshConnectOptions,
    private readonly ssh: ServerWatcherSsh,
    private readonly onSample: (sample: RawSample) => void,
    private readonly onDockerEvent: (event: NormalizedDockerEvent) => void,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  start() {
    this.stopped = false;
    void this.runLoop('sample');
    void this.runLoop('events');
  }

  stop() {
    this.stopped = true;
  }

  private handleChunk(kind: StreamKind, chunk: string) {
    if (kind === 'sample') {
      this.sampleBuffer += chunk;
      const lines = this.sampleBuffer.split('\n');
      this.sampleBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const sample = parseSampleLine(rawLine);
        if (sample) this.onSample(sample);
      }
    } else {
      this.eventsBuffer += chunk;
      const lines = this.eventsBuffer.split('\n');
      this.eventsBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const event = parseDockerEventLine(rawLine);
        if (event) this.onDockerEvent(event);
      }
    }
  }

  private async runLoop(kind: StreamKind) {
    const command = kind === 'sample' ? MONITORING_SAMPLE_COMMAND : DOCKER_EVENTS_COMMAND;
    while (!this.stopped) {
      const controller = new AbortController();
      await this.ssh.runCommand(this.options, command, LOOP_TIMEOUT_MS, (chunk) => this.handleChunk(kind, chunk), controller.signal);
      if (this.stopped) return;
      const attempt = kind === 'sample' ? ++this.sampleAttempt : ++this.eventsAttempt;
      await this.sleepFn(nextBackoffMs(attempt));
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/monitoring/server-watcher.spec.ts`
Expected: `server-watcher self-check OK`

Se `testReconnectAndStop` falhar por race condition (o teste depende de timing de `setTimeout`), aumentar os delays de `20` pra `50` no teste antes de investigar mais fundo — mas o comportamento esperado (reconectar até `stop()`) deve se manter estável nesse tempo de espera.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/monitoring/server-watcher.ts apps/api/src/monitoring/server-watcher.spec.ts
git commit -m "ServerWatcher: streaming SSH de métricas e eventos com reconexão"
```

---

### Task 7: Estender o poll sob demanda existente (`GET /servers/:id/metrics`) com CPU% e temperatura

**Files:**
- Modify: `apps/api/src/servers/metrics.util.ts`
- Modify: `apps/api/src/servers/servers.service.ts:167-195` (método `collectMetrics`)
- Test: `apps/api/src/servers/metrics.util.spec.ts` (novo)

**Interfaces:**
- Consumes: nenhuma nova (arquivo já existe).
- Produces: `ServerMetrics.cpuPercent: number | null` e `ServerMetrics.temperatureCelsius: number | null` — consumidos pelo frontend (fora do escopo deste plano) e persistidos em `ServerMetricSample` por `collectMetrics`.

- [ ] **Step 1: Escrever o teste**

`apps/api/src/servers/metrics.util.spec.ts`:

```ts
/**
 * Self-check do parser de métricas (agora com CPU/temperatura) — sem
 * framework: npx ts-node src/servers/metrics.util.spec.ts
 */
import assert from 'node:assert';
import { parseMetrics } from './metrics.util';

const output = [
  'UPTIME: 10:00:00 up 5 days,  2:30,  1 user,  load average: 0.52, 0.58, 0.59',
  'MEM:7975 3210',
  'DISK:50G 20G 42%',
  'CPU:37',
  'TEMP:45.0',
].join('\n');

const metrics = parseMetrics(output);
assert.deepEqual(metrics.loadAvg, [0.52, 0.58, 0.59]);
assert.equal(metrics.memTotalMb, 7975);
assert.equal(metrics.memUsedMb, 3210);
assert.equal(metrics.diskPercent, '42%');
assert.equal(metrics.cpuPercent, 37);
assert.equal(metrics.temperatureCelsius, 45.0);

// servidor sem lm-sensors instalado: TEMP vem vazio, não deve quebrar nem
// virar 0 (0°C seria um dado errado, não "não disponível")
const withoutSensors = parseMetrics(['UPTIME: up', 'MEM:7975 3210', 'DISK:50G 20G 42%', 'CPU:12', 'TEMP:'].join('\n'));
assert.equal(withoutSensors.cpuPercent, 12);
assert.equal(withoutSensors.temperatureCelsius, null);

console.log('metrics.util self-check OK');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/servers/metrics.util.spec.ts`
Expected: falha no `assert.equal(metrics.cpuPercent, 37)` (`undefined` !== `37`) — `parseMetrics` ainda não devolve esse campo.

- [ ] **Step 3: Estender `metrics.util.ts`**

Substituir o conteúdo de `apps/api/src/servers/metrics.util.ts` por:

```ts
export const METRICS_COMMAND =
  'echo "UPTIME:$(uptime)"; ' +
  'echo "MEM:$(free -m | awk \'/Mem:/ {print $2, $3}\')"; ' +
  'echo "DISK:$(df -h / | awk \'NR==2 {print $2, $3, $5}\')"; ' +
  'read -r _ a1 b1 c1 d1 e1 f1 g1 h1 _ < /proc/stat; sleep 1; read -r _ a2 b2 c2 d2 e2 f2 g2 h2 _ < /proc/stat; ' +
  't1=$((a1+b1+c1+d1+e1+f1+g1+h1)); t2=$((a2+b2+c2+d2+e2+f2+g2+h2)); dt=$((t2-t1)); di=$((d2-d1)); ' +
  'if [ "$dt" -gt 0 ]; then echo "CPU:$(( (100*(dt-di))/dt ))"; else echo "CPU:"; fi; ' +
  'echo "TEMP:$(sensors -j 2>/dev/null | grep -m1 temp1_input | grep -oE \'[0-9]+\\.[0-9]+\')"';

export interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotal: string | null;
  diskUsed: string | null;
  diskPercent: string | null;
  cpuPercent: number | null;
  temperatureCelsius: number | null;
}

function line(output: string, prefix: string): string | null {
  const found = output.split('\n').find((l) => l.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

export function parseMetrics(output: string): ServerMetrics {
  const uptimeLine = line(output, 'UPTIME:');
  const memLine = line(output, 'MEM:');
  const diskLine = line(output, 'DISK:');
  const cpuLine = line(output, 'CPU:');
  const tempLine = line(output, 'TEMP:');

  const loadMatch = uptimeLine?.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const uptimeMatch = uptimeLine?.match(/up\s+(.*?),\s+\d+\s+users?,/);

  const [memTotal, memUsed] = memLine?.split(/\s+/).map(Number) ?? [];
  const [diskTotal, diskUsed, diskPercent] = diskLine?.split(/\s+/) ?? [];

  const cpuPercent = cpuLine ? Number(cpuLine) : NaN;
  const temperatureCelsius = tempLine ? Number(tempLine) : NaN;

  return {
    uptimeText: uptimeMatch?.[1] ?? uptimeLine ?? null,
    loadAvg: loadMatch ? [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])] : null,
    memTotalMb: Number.isFinite(memTotal) ? memTotal : null,
    memUsedMb: Number.isFinite(memUsed) ? memUsed : null,
    diskTotal: diskTotal ?? null,
    diskUsed: diskUsed ?? null,
    diskPercent: diskPercent ?? null,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
    temperatureCelsius: Number.isFinite(temperatureCelsius) ? temperatureCelsius : null,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/servers/metrics.util.spec.ts`
Expected: `metrics.util self-check OK`

- [ ] **Step 5: Persistir os campos novos em `collectMetrics` e ajustar o timeout**

Em `apps/api/src/servers/servers.service.ts`, dentro de `collectMetrics` (linhas 167-195 atuais):

Trocar:
```ts
    const result = await this.ssh.runCommand(options, METRICS_COMMAND, 15_000);
```
por (o `sleep 1` novo no comando exige um pouco mais de margem):
```ts
    const result = await this.ssh.runCommand(options, METRICS_COMMAND, 20_000);
```

E trocar:
```ts
    await this.prisma.serverMetricSample.create({
      data: {
        serverId: id,
        loadAvg1: metrics.loadAvg?.[0] ?? null,
        memUsedMb: metrics.memUsedMb,
        memTotalMb: metrics.memTotalMb,
        diskPercent: metrics.diskPercent ? Number(metrics.diskPercent.replace('%', '')) : null,
      },
    });
```
por:
```ts
    await this.prisma.serverMetricSample.create({
      data: {
        serverId: id,
        loadAvg1: metrics.loadAvg?.[0] ?? null,
        memUsedMb: metrics.memUsedMb,
        memTotalMb: metrics.memTotalMb,
        diskPercent: metrics.diskPercent ? Number(metrics.diskPercent.replace('%', '')) : null,
        cpuPercent: metrics.cpuPercent,
        temperatureCelsius: metrics.temperatureCelsius,
      },
    });
```

- [ ] **Step 6: Checar tipos**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/servers/metrics.util.ts apps/api/src/servers/metrics.util.spec.ts apps/api/src/servers/servers.service.ts
git commit -m "GET /servers/:id/metrics ganha CPU% e temperatura"
```

---

### Task 8: Módulo `push` — registro de dispositivo e envio via Firebase

**Files:**
- Create: `apps/api/src/push/push.util.ts`
- Test: `apps/api/src/push/push.util.spec.ts`
- Create: `apps/api/src/push/push.service.ts`
- Create: `apps/api/src/push/dto/register-device.dto.ts`
- Create: `apps/api/src/push/push.controller.ts`
- Create: `apps/api/src/push/push.module.ts`
- Modify: `apps/api/package.json` (dependência `firebase-admin`)
- Modify: `apps/api/.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `PushService.sendToUser(userId: string, message: PushMessage): Promise<void>`, `PushService.registerDevice(userId, platform, fcmToken)`, `PushService.unregisterDevice(userId, deviceId)` — consumidos por `threshold-alert.service.ts` (Task 10). Rotas `POST /push/devices`, `DELETE /push/devices/:id`.

- [ ] **Step 1: Adicionar a dependência**

Em `apps/api/package.json`, no bloco `"dependencies"`, adicionar (ordem alfabética, ao lado de `"@aws-sdk/client-s3"` como referência de estilo):

```json
    "firebase-admin": "^12.7.0",
```

Run: `cd apps/api && npm install`
Expected: instala sem erro, `package-lock.json` atualizado.

- [ ] **Step 2: Escrever o teste da lógica pura de token inválido**

`apps/api/src/push/push.util.spec.ts`:

```ts
/**
 * Self-check da detecção de token FCM inválido — sem framework:
 *   npx ts-node src/push/push.util.spec.ts
 */
import assert from 'node:assert';
import { collectInvalidTokens } from './push.util';

const tokens = ['token-a', 'token-b', 'token-c'];
const responses = [
  { success: true },
  { success: false, error: { code: 'messaging/registration-token-not-registered' } },
  { success: false, error: { code: 'messaging/internal-error' } }, // erro transitório, não remove o token
];

assert.deepEqual(collectInvalidTokens(tokens, responses), ['token-b']);
assert.deepEqual(collectInvalidTokens([], []), []);
assert.deepEqual(collectInvalidTokens(['t1'], [{ success: true }]), []);

console.log('push.util self-check OK');
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd apps/api && npx ts-node src/push/push.util.spec.ts`
Expected: `Cannot find module './push.util'`

- [ ] **Step 4: Implementar `push.util.ts`**

```ts
export interface FcmResponse {
  success: boolean;
  error?: { code?: string };
}

/**
 * Só remove o token quando o FCM confirma que ele não existe mais
 * (desinstalou o app, trocou de aparelho) — erros transitórios (rede,
 * limite de taxa) não devem apagar um token que ainda pode funcionar depois.
 */
export function collectInvalidTokens(tokens: string[], responses: FcmResponse[]): string[] {
  const invalid: string[] = [];
  responses.forEach((res, i) => {
    if (!res.success && res.error?.code === 'messaging/registration-token-not-registered') {
      invalid.push(tokens[i]);
    }
  });
  return invalid;
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd apps/api && npx ts-node src/push/push.util.spec.ts`
Expected: `push.util self-check OK`

- [ ] **Step 6: Implementar `push.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { collectInvalidTokens } from './push.util';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private sender: admin.messaging.Messaging | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  private getSender(): admin.messaging.Messaging | null {
    if (this.sender !== undefined) return this.sender;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON não configurado — push notification desabilitado.');
      this.sender = null;
      return null;
    }

    try {
      const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
      this.sender = admin.messaging(app);
    } catch (err) {
      this.logger.error(`Falha ao inicializar Firebase: ${err instanceof Error ? err.message : err}`);
      this.sender = null;
    }
    return this.sender;
  }

  async registerDevice(userId: string, platform: 'ios' | 'android', fcmToken: string) {
    await this.prisma.deviceToken.upsert({
      where: { fcmToken },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, platform, fcmToken },
    });
  }

  async unregisterDevice(userId: string, id: string) {
    await this.prisma.deviceToken.deleteMany({ where: { id, userId } });
  }

  async sendToUser(userId: string, message: PushMessage) {
    const sender = this.getSender();
    if (!sender) return;

    const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (devices.length === 0) return;

    const tokens = devices.map((d) => d.fcmToken);
    let result: admin.messaging.BatchResponse;
    try {
      result = await sender.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
      });
    } catch (err) {
      this.logger.warn(`Falha ao enviar push pro usuário ${userId}: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const invalid = collectInvalidTokens(tokens, result.responses);
    if (invalid.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { fcmToken: { in: invalid } } });
    }
  }
}
```

- [ ] **Step 7: Implementar o DTO e o controller**

`apps/api/src/push/dto/register-device.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  @IsNotEmpty()
  fcmToken!: string;
}
```

`apps/api/src/push/push.controller.ts`:

```ts
import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller('push/devices')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  async register(@Body() dto: RegisterDeviceDto, @Req() req: AuthedRequest) {
    await this.push.registerDevice(req.user.sub, dto.platform, dto.fcmToken);
    return { ok: true };
  }

  @Delete(':id')
  async unregister(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.push.unregisterDevice(req.user.sub, id);
    return { ok: true };
  }
}
```

`apps/api/src/push/push.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
```

- [ ] **Step 8: Documentar a variável de ambiente**

Em `apps/api/.env.example`, adicionar ao final:

```
# Opcional — sem isso, push notification fica desabilitado (o resto da API
# funciona normalmente). JSON da service account do projeto Firebase, numa
# linha só. Gerado em: Firebase Console > Configurações do projeto > Contas
# de serviço > Gerar nova chave privada.
FIREBASE_SERVICE_ACCOUNT_JSON=
```

Em `docker-compose.yml`, dentro do bloco `environment:` do serviço `api` (perto de `VELIX_ADMIN_PASSWORD`), adicionar:

```yaml
      FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON:-}
```

- [ ] **Step 9: Checar tipos**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/push apps/api/package.json apps/api/package-lock.json apps/api/.env.example docker-compose.yml
git commit -m "Módulo push: registro de dispositivo e envio via Firebase Cloud Messaging"
```

---

### Task 9: Módulo `alert-thresholds` — CRUD de preferências (global + override por servidor)

**Files:**
- Create: `apps/api/src/alert-thresholds/dto/update-threshold.dto.ts`
- Create: `apps/api/src/alert-thresholds/alert-thresholds.service.ts`
- Create: `apps/api/src/alert-thresholds/alert-thresholds.controller.ts`
- Create: `apps/api/src/alert-thresholds/alert-thresholds.module.ts`

**Interfaces:**
- Produces: rotas `GET/PUT /alerts/thresholds` (preferência global) e `GET/PUT /servers/:id/alerts/thresholds` (override por servidor) — usadas pelos apps móveis (fora do escopo deste plano) e pela tela de configurações do painel web (fora do escopo deste plano).
- Nenhum spec dedicado — serviço só orquestra Prisma (mesmo padrão de `alerts.service.ts`/`database-console.service.ts`, que também não têm spec).

- [ ] **Step 1: Implementar o DTO**

`apps/api/src/alert-thresholds/dto/update-threshold.dto.ts`:

```ts
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateThresholdDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  cpuPercent?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  memoryPercent?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  temperatureCelsius?: number | null;

  @IsOptional()
  @IsIn(['all', 'managed_apps'])
  dockerScope?: 'all' | 'managed_apps';

  @IsOptional()
  @IsBoolean()
  dockerEnabled?: boolean;
}
```

- [ ] **Step 2: Implementar o serviço**

`apps/api/src/alert-thresholds/alert-thresholds.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateThresholdDto } from './dto/update-threshold.dto';

@Injectable()
export class AlertThresholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobal(userId: string) {
    return this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId: null } });
  }

  async updateGlobal(userId: string, dto: UpdateThresholdDto) {
    const existing = await this.getGlobal(userId);
    if (existing) {
      return this.prisma.alertThresholdPreference.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.alertThresholdPreference.create({ data: { userId, serverId: null, ...dto } });
  }

  async getForServer(userId: string, serverId: string) {
    return this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId } });
  }

  async updateForServer(userId: string, serverId: string, dto: UpdateThresholdDto) {
    const existing = await this.getForServer(userId, serverId);
    if (existing) {
      return this.prisma.alertThresholdPreference.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.alertThresholdPreference.create({ data: { userId, serverId, ...dto } });
  }
}
```

- [ ] **Step 3: Implementar o controller**

`apps/api/src/alert-thresholds/alert-thresholds.controller.ts`:

```ts
import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { AlertThresholdsService } from './alert-thresholds.service';
import { UpdateThresholdDto } from './dto/update-threshold.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller()
@UseGuards(JwtAuthGuard)
export class AlertThresholdsController {
  constructor(private readonly thresholds: AlertThresholdsService) {}

  @Get('alerts/thresholds')
  getGlobal(@Req() req: AuthedRequest) {
    return this.thresholds.getGlobal(req.user.sub);
  }

  @Put('alerts/thresholds')
  updateGlobal(@Body() dto: UpdateThresholdDto, @Req() req: AuthedRequest) {
    return this.thresholds.updateGlobal(req.user.sub, dto);
  }

  @Get('servers/:id/alerts/thresholds')
  getForServer(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.thresholds.getForServer(req.user.sub, id);
  }

  @Put('servers/:id/alerts/thresholds')
  updateForServer(@Param('id') id: string, @Body() dto: UpdateThresholdDto, @Req() req: AuthedRequest) {
    return this.thresholds.updateForServer(req.user.sub, id, dto);
  }
}
```

- [ ] **Step 4: Implementar o módulo**

`apps/api/src/alert-thresholds/alert-thresholds.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlertThresholdsController } from './alert-thresholds.controller';
import { AlertThresholdsService } from './alert-thresholds.service';

@Module({
  imports: [AuthModule],
  controllers: [AlertThresholdsController],
  providers: [AlertThresholdsService],
})
export class AlertThresholdsModule {}
```

- [ ] **Step 5: Checar tipos**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/alert-thresholds
git commit -m "CRUD de limites de alerta por usuário: global e override por servidor"
```

---

### Task 10: `threshold-alert.service.ts` — liga amostras/eventos do watcher ao push

**Files:**
- Create: `apps/api/src/monitoring/threshold-alert.service.ts`

**Interfaces:**
- Consumes: `resolveThresholdsForServer` (Task 4), `computeCpuPercent`/`computeMemoryPercent` (Task 2), `NormalizedDockerEvent` (Task 3), `PushService.sendToUser` (Task 8).
- Produces: `ThresholdAlertService.handleSample(serverId: string, sample: RawSample): Promise<void>`, `ThresholdAlertService.handleDockerEvent(serverId: string, event: NormalizedDockerEvent): Promise<void>` — consumidos por `monitoring.service.ts` (Task 11).
- Sem spec dedicado: a lógica de decisão (abre/resolve) é a mesma de duas linhas já usada sem teste em `alerts.service.ts` (`check()`), e o resto do método é orquestração de Prisma — mesmo padrão do resto do repo.

- [ ] **Step 1: Implementar `threshold-alert.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { resolveThresholdsForServer, ThresholdPreferenceRow } from './threshold-resolver.util';
import { computeCpuPercent, computeMemoryPercent, RawSample } from './metrics-sample.util';
import { NormalizedDockerEvent } from './docker-event.util';

type MetricKey = 'cpu' | 'memory' | 'temperature';

/**
 * Recebe as amostras/eventos que o ServerWatcher produz, resolve o limite de
 * cada usuário interessado naquele servidor e decide se dispara push — abre
 * quando cruza o limite, lembra a cada 15min enquanto continuar ativo,
 * resolve quando volta ao normal (mesma ideia do AlertState de
 * alerts.service.ts, mas por usuário em vez de global).
 * Eventos de container são discretos (o próprio `docker events` só emite
 * cada um uma vez) — não passam pelo padrão abre/resolve, disparam direto.
 */
@Injectable()
export class ThresholdAlertService {
  private readonly logger = new Logger(ThresholdAlertService.name);
  private readonly lastRawSample = new Map<string, RawSample>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async handleSample(serverId: string, sample: RawSample) {
    const prev = this.lastRawSample.get(serverId) ?? null;
    this.lastRawSample.set(serverId, sample);

    const cpuPercent = computeCpuPercent(prev, sample);
    const memoryPercent = computeMemoryPercent(sample);
    const temperatureCelsius = sample.temperatureCelsius;

    const resolved = resolveThresholdsForServer(await this.loadPreferences(serverId), serverId);

    for (const pref of resolved) {
      if (cpuPercent !== null && pref.cpuPercent !== null) {
        await this.evaluate('cpu', serverId, pref.userId, cpuPercent >= pref.cpuPercent, {
          title: 'CPU alta',
          body: `CPU em ${cpuPercent}%, acima do limite de ${pref.cpuPercent}%.`,
        });
      }
      if (memoryPercent !== null && pref.memoryPercent !== null) {
        await this.evaluate('memory', serverId, pref.userId, memoryPercent >= pref.memoryPercent, {
          title: 'Memória alta',
          body: `Memória em ${memoryPercent}%, acima do limite de ${pref.memoryPercent}%.`,
        });
      }
      if (temperatureCelsius !== null && pref.temperatureCelsius !== null) {
        await this.evaluate('temperature', serverId, pref.userId, temperatureCelsius >= pref.temperatureCelsius, {
          title: 'Temperatura alta',
          body: `Temperatura em ${temperatureCelsius}°C, acima do limite de ${pref.temperatureCelsius}°C.`,
        });
      }
    }
  }

  async handleDockerEvent(serverId: string, event: NormalizedDockerEvent) {
    const resolved = resolveThresholdsForServer(await this.loadPreferences(serverId), serverId);

    for (const pref of resolved) {
      if (!pref.dockerEnabled) continue;

      if (pref.dockerScope === 'managed_apps') {
        const managed = await this.prisma.application.findFirst({
          where: { serverId, containerNames: { has: event.containerName } },
          select: { id: true },
        });
        if (!managed) continue;
      }

      const verb = event.kind === 'restarted' ? 'reiniciou' : event.kind === 'crashed' ? 'travou' : 'parou';
      await this.push
        .sendToUser(pref.userId, {
          title: `Container ${verb}`,
          body: `${event.containerName} ${verb}${event.exitCode !== null ? ` (código ${event.exitCode})` : ''}.`,
          data: { serverId, containerId: event.containerId },
        })
        .catch((err) => this.logger.warn(`push de evento docker falhou: ${err instanceof Error ? err.message : err}`));
    }
  }

  private async loadPreferences(serverId: string): Promise<ThresholdPreferenceRow[]> {
    // ponytail: consulta o banco a cada amostra (a cada 5s por servidor) em
    // vez de cachear em memória — número de servidores/usuários de uma
    // instalação Velix é pequeno o bastante pra isso não pesar. Cachear com
    // invalidação quando a preferência muda vira necessário só se a escala
    // da instalação crescer muito.
    return this.prisma.alertThresholdPreference.findMany({ where: { OR: [{ serverId }, { serverId: null }] } });
  }

  /** Enquanto a condição continuar ativa sem se resolver, reenvia um lembrete
   * a cada 15min — sem isso, quem recebeu o alerta às 3h não tem como saber
   * se ainda está de pé sem abrir o app. `AlertState.lastSeenAt` (já existe,
   * `@updatedAt`) guarda quando foi o último envio: só é tocado quando este
   * método realmente manda um push (abertura ou lembrete), nunca nos ticks
   * em que nada acontece — é isso que faz o intervalo de 15min valer. */
  private static readonly REMINDER_INTERVAL_MS = 15 * 60 * 1000;

  private async evaluate(
    metric: MetricKey,
    serverId: string,
    userId: string,
    isActive: boolean,
    content: { title: string; body: string },
  ) {
    const fingerprint = `${metric}-high:${serverId}:${userId}`;
    const state = await this.prisma.alertState.findUnique({ where: { fingerprint } });

    if (isActive && !state) {
      await this.prisma.alertState.create({ data: { fingerprint } });
      await this.push
        .sendToUser(userId, { title: content.title, body: content.body, data: { serverId, metric } })
        .catch((err) => this.logger.warn(`push de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
      return;
    }

    if (isActive && state) {
      const elapsed = Date.now() - state.lastSeenAt.getTime();
      if (elapsed < ThresholdAlertService.REMINDER_INTERVAL_MS) return;
      await this.prisma.alertState.update({ where: { fingerprint }, data: {} }); // bump lastSeenAt (@updatedAt)
      await this.push
        .sendToUser(userId, { title: content.title, body: content.body, data: { serverId, metric } })
        .catch((err) => this.logger.warn(`lembrete de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
      return;
    }

    if (!isActive && state) {
      await this.prisma.alertState.delete({ where: { fingerprint } });
      await this.push
        .sendToUser(userId, {
          title: `${content.title}: normalizado`,
          body: `Voltou ao normal em ${new Date().toLocaleString('pt-BR')}.`,
          data: { serverId, metric },
        })
        .catch((err) => this.logger.warn(`push de resolução de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
    }
  }
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/monitoring/threshold-alert.service.ts
git commit -m "Avaliador de limite por usuário: liga watcher, preferências e push"
```

---

### Task 11: `monitoring.service.ts` + `monitoring.module.ts` — orquestração e wiring final

**Files:**
- Create: `apps/api/src/monitoring/monitoring.service.ts`
- Create: `apps/api/src/monitoring/monitoring.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `ServerWatcher` (Task 6), `ThresholdAlertService` (Task 10), `ServersService.getServerWithConnectOptions` (já existe, `apps/api/src/servers/servers.service.ts:115-117`), `SshService` (já existe).
- Produces: nada consumido por outra task — é o topo da árvore de dependências deste plano.

- [ ] **Step 1: Implementar `monitoring.service.ts`**

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { ServerWatcher } from './server-watcher';
import { ThresholdAlertService } from './threshold-alert.service';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly watchers = new Map<string, ServerWatcher>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
    private readonly evaluator: ThresholdAlertService,
  ) {}

  async onModuleInit() {
    await this.reconcile();
  }

  onModuleDestroy() {
    for (const watcher of this.watchers.values()) watcher.stop();
  }

  /**
   * Compara servidores cadastrados com watchers rodando e ajusta — cobre
   * servidor criado/removido sem precisar acoplar ServersService a este
   * módulo. Roda a cada minuto: novo servidor cadastrado leva até 1min pra
   * começar a ser monitorado, o que é aceitável (o cadastro em si não é uma
   * operação de alta frequência).
   */
  @Cron('*/1 * * * *')
  async reconcile() {
    const servers = await this.prisma.server.findMany({ select: { id: true } });
    const currentIds = new Set(servers.map((s) => s.id));

    for (const [id, watcher] of this.watchers) {
      if (!currentIds.has(id)) {
        watcher.stop();
        this.watchers.delete(id);
      }
    }

    for (const id of currentIds) {
      if (this.watchers.has(id)) continue;
      try {
        const { options } = await this.servers.getServerWithConnectOptions(id);
        const watcher = new ServerWatcher(
          id,
          options,
          this.ssh,
          (sample) => void this.evaluator.handleSample(id, sample).catch((err) => this.logger.warn(`amostra de ${id}: ${err}`)),
          (event) => void this.evaluator.handleDockerEvent(id, event).catch((err) => this.logger.warn(`evento de ${id}: ${err}`)),
        );
        watcher.start();
        this.watchers.set(id, watcher);
      } catch (err) {
        this.logger.warn(`Não foi possível iniciar monitoramento de ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
```

- [ ] **Step 2: Implementar `monitoring.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { PushModule } from '../push/push.module';
import { MonitoringService } from './monitoring.service';
import { ThresholdAlertService } from './threshold-alert.service';

@Module({
  imports: [ServersModule, PushModule],
  providers: [MonitoringService, ThresholdAlertService],
})
export class MonitoringModule {}
```

- [ ] **Step 3: Registrar os três módulos novos em `app.module.ts`**

Em `apps/api/src/app.module.ts`, adicionar os imports:

```ts
import { PushModule } from './push/push.module';
import { AlertThresholdsModule } from './alert-thresholds/alert-thresholds.module';
import { MonitoringModule } from './monitoring/monitoring.module';
```

E adicionar ao array `imports` do `@Module`, depois de `AlertsModule`:

```ts
    AlertsModule,
    PushModule,
    AlertThresholdsModule,
    MonitoringModule,
    UsersModule,
```

- [ ] **Step 4: Checar tipos**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 5: Confirmar que o grafo de injeção do Nest resolve inteiro**

Run: `cd apps/api && npx ts-node src/app.module.spec.ts`
Expected: passa sem erro — prova que `MonitoringModule`/`PushModule`/`AlertThresholdsModule` estão todos com as dependências certas importadas (é exatamente o que este spec existe pra pegar, ver o comentário no topo do arquivo sobre o bug do `UsersModule`/`AuditService` na v1.9.0).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/monitoring/monitoring.service.ts apps/api/src/monitoring/monitoring.module.ts apps/api/src/app.module.ts
git commit -m "Liga o monitoramento em tempo real: reconciliação de watchers por servidor"
```

---

### Task 12: Build completo e checklist de verificação manual

**Files:** nenhum arquivo novo — só verificação.

- [ ] **Step 1: Build da API**

Run: `cd apps/api && npx nest build`
Expected: `✓ Generated Prisma Client` (do postinstall/prebuild se configurado) e build sem erro, `dist/main.js` gerado.

- [ ] **Step 2: Rodar todos os `*.spec.ts` deste plano em sequência**

Run:
```bash
cd apps/api
npx ts-node src/monitoring/metrics-sample.util.spec.ts
npx ts-node src/monitoring/docker-event.util.spec.ts
npx ts-node src/monitoring/threshold-resolver.util.spec.ts
npx ts-node src/monitoring/backoff.util.spec.ts
npx ts-node src/monitoring/server-watcher.spec.ts
npx ts-node src/servers/metrics.util.spec.ts
npx ts-node src/push/push.util.spec.ts
npx ts-node src/app.module.spec.ts
```
Expected: todas as linhas `... self-check OK` (ou equivalente), sem erro nem exceção.

- [ ] **Step 3: Checklist manual contra um servidor real (não automatizável neste ambiente — sem servidor/Docker/Firebase disponíveis aqui)**

Antes de considerar esta entrega pronta pra produção, validar manualmente contra um servidor de verdade cadastrado no Velix:

- [ ] Cadastrar (ou usar um já existente) um servidor com Docker rodando; confirmar nos logs da API (`docker logs velix-api` ou equivalente) que o watcher iniciou pra ele em até 1 minuto depois do boot da API.
- [ ] Derrubar a conexão SSH do servidor (ex.: reiniciar o `sshd` ou bloquear a porta temporariamente) e confirmar no log que o watcher tenta reconectar com backoff crescente, e volta a funcionar quando a conexão retorna.
- [ ] Rodar `docker stop <container>` num container qualquer do servidor e, com uma `AlertThresholdPreference` configurada (`dockerEnabled: true`, `dockerScope: 'all'`), confirmar que chega uma notificação (verificar via log do `PushService` ou um token de teste real).
- [ ] Repetir com `docker restart <container>` — confirmar que classifica como "reiniciou", não "parou".
- [ ] Num servidor sem `lm-sensors` instalado (a maioria dos VPS), confirmar que o watcher não trava nem gera erro — só fica sem o dado de temperatura.
- [ ] Configurar um `cpuPercent` bem baixo (ex.: 1%) pra forçar o alerta a abrir quase imediatamente, confirmar que o push chega, depois confirmar que some (resolve) quando o limite for ajustado pra um valor alto.
- [ ] Com um token de dispositivo FCM real (de um app de teste mínimo, ou via `curl` direto na API do FCM), confirmar `POST /push/devices` grava e `sendToUser` realmente entrega notificação no aparelho.
- [ ] Desinstalar o app de teste (invalidando o token) e confirmar que o próximo envio remove o `DeviceToken` correspondente do banco.

- [ ] **Step 4: Nenhum commit nesta task — é só verificação. Se algum item do checklist falhar, voltar pra task correspondente, corrigir, e repetir os steps 1-2 antes de tentar de novo.**

---

## Observação fora do escopo deste plano

`FIREBASE_SERVICE_ACCOUNT_JSON` foi adicionado ao `docker-compose.yml` e ao `.env.example`, mas **não** ao gerador de `.env` do instalador (`install.sh`/`write_env_file`) — esse arquivo é reescrito do zero a cada instalação/atualização (ver comentário sobre `CF_DNS_API_TOKEN` em `install.sh:707-712`), e preservar essa variável entre reinstalações precisa do mesmo tratamento especial que o token do Cloudflare já tem. Ficou de fora porque é uma mudança no instalador de produção, um risco maior e um escopo diferente do resto deste plano (que é só o backend da API). Antes de depender de push em produção, alguém precisa: (1) adicionar `FIREBASE_SERVICE_ACCOUNT_JSON` à leitura/preservação em `generate_environment()` do `install.sh`, do mesmo jeito que `CF_DNS_API_TOKEN`, ou (2) documentar que quem habilitar push precisa reeditar o `.env` manualmente depois de cada atualização do Velix.
