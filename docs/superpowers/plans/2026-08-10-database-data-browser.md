# Gerenciador de banco de dados embutido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** substituir o botão "Abrir interface web" (Adminer) por uma aba "Dados" embutida na página do banco, com navegação de tabelas/linhas (só leitura) e um editor SQL livre com histórico de execuções.

**Architecture:** o backend abre um túnel SSH efêmero até o servidor gerenciado (reaproveitando `ssh2`, já dependência), resolve o IP do container na rede Docker `velix-proxy`, e conecta por ali com o driver nativo do motor (`mysql2`/`pg`, dependências novas). Autentica sozinho com a senha root já gerada no deploy. Sem WebSocket — cada ação da UI é uma requisição HTTP simples que abre o túnel, executa, devolve JSON e fecha.

**Tech Stack:** NestJS/Prisma (API), Next.js/React/Tailwind (web), `ssh2` (túnel), `mysql2`/`pg` (drivers novos).

## Global Constraints

- Nunca `Co-Authored-By: Claude` em nenhum commit.
- Migração Prisma só com `CREATE TABLE`/`ADD COLUMN` — nunca `ALTER TYPE` na mesma transação que usa o valor novo (lição da v1.11.0).
- Nome de tabela só entra num identificador SQL depois de validado contra a lista real de tabelas do banco (nunca interpolado direto de parâmetro de URL) — mesma lição de injeção da v1.15.2.
- Self-checks de função pura via `npx ts-node <arquivo>.spec.ts` com `assert` — sem framework de teste novo, mesmo padrão já usado em todo o backend.
- Ao final: `tsc --noEmit` + `nest build` (API) e `tsc --noEmit` + `next build` (web) têm que passar limpos antes de qualquer commit de fechamento.
- Bump de `apps/api/VERSION`, commit em português explicando causa/mudança/o que foi testado, `git push origin main`, `gh release create` com notas em português — ritual já estabelecido nesta sessão.

---

## Referência: spec

Ver `docs/superpowers/specs/2026-08-10-database-data-browser-design.md` para o design completo e o que ficou fora de escopo.

---

### Task 1: Dependências novas (`mysql2`, `pg`)

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `mysql2/promise` (`createConnection`) e `pg` (`Client`) disponíveis pras tasks seguintes.

- [ ] **Step 1: Adicionar as dependências**

Em `apps/api/package.json`, dentro de `"dependencies"` (ordem alfabética, mesmo estilo do resto do arquivo):

```json
    "mysql2": "^3.11.0",
```

(entre `"marked"` e `"nodemailer"`)

```json
    "pg": "^8.13.0",
```

(entre `"otplib"` e `"prisma"`)

E em `"devDependencies"`:

```json
    "@types/pg": "^8.11.0",
```

(entre `"@types/nodemailer"` e `"@types/qrcode"` — `mysql2` já vem com seus próprios tipos, sem `@types` separado)

- [ ] **Step 2: Instalar**

```bash
cd apps/api && npm install
```

Expected: `npm install` termina sem erro, `node_modules/mysql2` e `node_modules/pg` existem.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "Adiciona mysql2 e pg — drivers pro console de banco embutido"
```

---

### Task 2: Modelo de dados (`DatabaseQueryLog`)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260810120000_database_query_log/migration.sql`

**Interfaces:**
- Produces: `prisma.databaseQueryLog` (Prisma Client), relações inversas `ProjectService.queryLogs` e `User.databaseQueryLogs`.

- [ ] **Step 1: Adicionar o model ao schema**

Em `apps/api/prisma/schema.prisma`, adicionar depois do model `ProjectService` (perto de `DatabaseBackupRun`, mesma vizinhança temática):

```prisma
/// Histórico de comandos SQL rodados pelo editor livre do console de banco
/// embutido — só o editor grava aqui (navegação de tabelas/linhas é gerada
/// pelo Velix, não digitada pelo usuário, não precisa de auditoria de
/// "o que foi digitado").
model DatabaseQueryLog {
  id               String         @id @default(uuid())
  projectServiceId String
  projectService   ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)
  userId           String
  user             User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  query      String
  ok         Boolean
  rowCount   Int?
  error      String?
  executedAt DateTime @default(now())

  @@index([projectServiceId, executedAt])
}
```

No model `ProjectService`, adicionar a relação inversa junto de `backupRuns`:

```prisma
  queryLogs       DatabaseQueryLog[]
```

No model `User`, adicionar:

```prisma
  databaseQueryLogs DatabaseQueryLog[]
```

- [ ] **Step 2: Escrever a migração à mão**

Criar `apps/api/prisma/migrations/20260810120000_database_query_log/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "DatabaseQueryLog" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "rowCount" INTEGER,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatabaseQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseQueryLog_projectServiceId_executedAt_idx" ON "DatabaseQueryLog"("projectServiceId", "executedAt");

-- AddForeignKey
ALTER TABLE "DatabaseQueryLog" ADD CONSTRAINT "DatabaseQueryLog_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQueryLog" ADD CONSTRAINT "DatabaseQueryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Gerar o Prisma Client**

```bash
cd apps/api && npx prisma generate
```

Expected: termina sem erro, `node_modules/@prisma/client` regenerado com `prisma.databaseQueryLog` disponível (confirmar com `grep -n "databaseQueryLog" node_modules/@prisma/client/index.d.ts | head -3`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260810120000_database_query_log
git commit -m "Adiciona DatabaseQueryLog — histórico de queries do console de banco"
```

---

### Task 3: `SshService.openTunnel` — túnel TCP via SSH

**Files:**
- Modify: `apps/api/src/ssh/ssh.service.ts`

**Interfaces:**
- Consumes: `SshConnectOptions` (já existe no mesmo arquivo).
- Produces: `SshService.openTunnel(options: SshConnectOptions, destHost: string, destPort: number, timeoutMs?: number): Promise<{ stream: Duplex; close: () => void }>` — usado pela Task 5.

- [ ] **Step 1: Adicionar o método**

Em `apps/api/src/ssh/ssh.service.ts`, adicionar `import type { Duplex } from 'stream';` ao topo (junto dos outros imports), e o método dentro de `class SshService`, depois de `runCommand`:

```ts
  /**
   * Abre um túnel TCP local → destino através da conexão SSH (equivalente a
   * `ssh -L`), sem publicar porta nenhuma no host — usado pelo console de
   * banco de dados pra falar com o driver nativo (mysql2/pg) através da
   * mesma conexão SSH que já autentica em todo o resto da plataforma, já que
   * a API não tem rota de rede direta até a rede Docker `velix-proxy` do
   * servidor gerenciado.
   *
   * A conexão SSH fica viva até quem chamou invocar `close()` — diferente de
   * `runCommand`, que abre e fecha sozinho por chamada.
   */
  openTunnel(
    options: SshConnectOptions,
    destHost: string,
    destPort: number,
    timeoutMs = 15_000,
  ): Promise<{ stream: Duplex; close: () => void }> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        conn.end();
        reject(new Error(message));
      };

      conn
        .on('ready', () => {
          conn.forwardOut('127.0.0.1', 0, destHost, destPort, (err, stream) => {
            if (err) {
              fail(`Falha ao abrir túnel SSH até ${destHost}:${destPort}: ${err.message}`);
              return;
            }
            settled = true;
            resolve({ stream, close: () => conn.end() });
          });
        })
        .on('error', (err) => fail(`Falha na conexão SSH: ${err.message}`))
        .connect({
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: options.privateKey,
          readyTimeout: timeoutMs,
        });
    });
  }
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: sem erros. **Sem servidor real neste ambiente pra testar o túnel de fato** — a verificação funcional fica pra Task 5 (que usa este método) e pro teste manual contra um servidor real antes de produção (ver seção de testes da spec).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/ssh/ssh.service.ts
git commit -m "SshService: adiciona openTunnel (encaminhamento TCP via SSH)"
```

---

### Task 4: `database-console.util.ts` — funções puras

**Files:**
- Create: `apps/api/src/database-console/database-console.util.ts`
- Create: `apps/api/src/database-console/database-console.util.spec.ts`

**Interfaces:**
- Produces: `DbEngine`, `resolveEngine(image)`, `enginePort(engine)`, `engineUser(engine)`, `isKnownTable(table, known)`, `paginate(page, pageSize)` — usados pelas Tasks 5 e 6.

- [ ] **Step 1: Escrever o util**

Criar `apps/api/src/database-console/database-console.util.ts`:

```ts
/** Funções puras do console de banco embutido — sem I/O, testáveis sem
 * rede/SSH/driver. Ver database-console.util.spec.ts. */

export type DbEngine = 'postgresql' | 'mysql' | 'mariadb';

/** Mesma detecção de imagem já usada em `dbImportSecretKey`/`dbConsoleCommand`
 * (container-shell.util.ts) — reaproveitada aqui como tipo literal em vez de
 * string solta, porque o resto deste módulo decide SQL/porta/usuário a partir
 * disto. */
export function resolveEngine(image: string): DbEngine | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'postgresql';
  if (img.includes('mariadb')) return 'mariadb';
  if (img.includes('mysql')) return 'mysql';
  return null;
}

export function enginePort(engine: DbEngine): number {
  return engine === 'postgresql' ? 5432 : 3306;
}

/** Sempre o superusuário criado pela imagem oficial — sem tela de login,
 * autentica sozinho com a senha root já gerada no deploy. */
export function engineUser(engine: DbEngine): string {
  return engine === 'postgresql' ? 'postgres' : 'root';
}

/** Nome de tabela só é seguro de interpolar num identificador SQL depois de
 * bater com a lista real de tabelas do banco (`information_schema`/`pg_class`)
 * — nunca confiado direto do parâmetro da URL. Mesma lição de injeção que já
 * pegou um bug real na v1.15.2 (dbImportCommand). */
export function isKnownTable(table: string, known: string[]): boolean {
  return known.includes(table);
}

/** Página/tamanho de página seguros — página inválida cai pra 1, tamanho
 * inválido ou acima do teto (200) cai pro padrão (50), pra nunca deixar
 * `LIMIT`/`OFFSET` receber algo fora do esperado. */
export function paginate(page: number, pageSize: number): { limit: number; offset: number } {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 200 ? pageSize : 50;
  return { limit: safeSize, offset: (safePage - 1) * safeSize };
}
```

- [ ] **Step 2: Escrever o self-check**

Criar `apps/api/src/database-console/database-console.util.spec.ts`:

```ts
/**
 * Self-check das funções puras do console de banco — sem framework:
 *   npx ts-node src/database-console/database-console.util.spec.ts
 */
import assert from 'node:assert';
import { resolveEngine, enginePort, engineUser, isKnownTable, paginate } from './database-console.util';

// --- resolveEngine ---------------------------------------------------------
assert.equal(resolveEngine('postgres:16.4'), 'postgresql');
assert.equal(resolveEngine('POSTGRES:16'), 'postgresql', 'case-insensitive');
assert.equal(resolveEngine('mariadb:11.4'), 'mariadb');
assert.equal(resolveEngine('mysql:8.4'), 'mysql');
assert.equal(resolveEngine('mongo:7'), null);
assert.equal(resolveEngine('nginx:alpine'), null);

// --- enginePort / engineUser ------------------------------------------------
assert.equal(enginePort('postgresql'), 5432);
assert.equal(enginePort('mysql'), 3306);
assert.equal(enginePort('mariadb'), 3306);
assert.equal(engineUser('postgresql'), 'postgres');
assert.equal(engineUser('mysql'), 'root');
assert.equal(engineUser('mariadb'), 'root');

// --- isKnownTable ------------------------------------------------------------
assert.equal(isKnownTable('users', ['users', 'posts']), true);
assert.equal(
  isKnownTable('users; DROP TABLE posts', ['users', 'posts']),
  false,
  'nome fora da lista real não passa, mesmo parecendo SQL válido',
);
assert.equal(isKnownTable('users', []), false);

// --- paginate ------------------------------------------------------------------
assert.deepEqual(paginate(1, 50), { limit: 50, offset: 0 });
assert.deepEqual(paginate(3, 20), { limit: 20, offset: 40 });
assert.deepEqual(paginate(0, 50), { limit: 50, offset: 0 }, 'página inválida cai pro padrão');
assert.deepEqual(paginate(1, 9999), { limit: 50, offset: 0 }, 'pageSize acima do teto cai pro padrão');
assert.deepEqual(paginate(-1, -1), { limit: 50, offset: 0 });

console.log('database-console.util self-check OK');
```

- [ ] **Step 3: Rodar o self-check**

```bash
cd apps/api && npx ts-node src/database-console/database-console.util.spec.ts
```

Expected: `database-console.util self-check OK`, sem erro de `assert`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database-console/database-console.util.ts apps/api/src/database-console/database-console.util.spec.ts
git commit -m "database-console.util: detecção de engine, validação de tabela e paginação"
```

---

### Task 5: `database-tunnel.service.ts` — conexão real ao banco

**Files:**
- Create: `apps/api/src/database-console/database-tunnel.service.ts`

**Interfaces:**
- Consumes: `SshService.openTunnel` (Task 3), `resolveEngine`/`enginePort`/`engineUser` (Task 4), `PrismaService`, `ServersService.getServerWithConnectOptions`, `decryptCredential` (`../ssh/crypto.util`), `dbImportSecretKey` (`../terminal/container-shell.util`), `PROXY_NETWORK` (`../traefik/traefik.util`), `shellSingleQuote` (`../database/mysql.util`).
- Produces: `DbConnection` (interface `{ query(sql, params?): Promise<{ rows, rowCount }> }`), `DatabaseTunnelService.withConnection<T>(projectServiceId, fn: (conn: DbConnection, engine: DbEngine) => Promise<T>): Promise<T>` — usado pela Task 6.

- [ ] **Step 1: Escrever o serviço**

Criar `apps/api/src/database-console/database-tunnel.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createConnection as createMysqlConnection } from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { decryptCredential } from '../ssh/crypto.util';
import { dbImportSecretKey } from '../terminal/container-shell.util';
import { shellSingleQuote } from '../database/mysql.util';
import { PROXY_NETWORK } from '../traefik/traefik.util';
import { resolveEngine, enginePort, engineUser, type DbEngine } from './database-console.util';

export interface DbConnection {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/**
 * Abre uma conexão real ao banco de um `ProjectService` — a API não tem rota
 * de rede até a rede Docker `velix-proxy` do servidor gerenciado, então o
 * caminho é: resolver o IP do container ali dentro via SSH, abrir um túnel
 * TCP através da mesma conexão SSH (`SshService.openTunnel`), e conectar o
 * driver nativo do motor (mysql2/pg) nesse túnel. Autentica sozinho com a
 * senha root já gerada no deploy — sem pedir login.
 *
 * `withConnection` garante que a conexão do driver e o túnel SSH sempre
 * fecham no `finally`, sucesso ou erro — sem isso cada query deixaria uma
 * conexão SSH pendurada no servidor gerenciado.
 */
@Injectable()
export class DatabaseTunnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
  ) {}

  async withConnection<T>(
    projectServiceId: string,
    fn: (conn: DbConnection, engine: DbEngine) => Promise<T>,
  ): Promise<T> {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) throw new NotFoundException('Banco não encontrado');

    const engine = resolveEngine(service.image);
    if (!engine) {
      throw new BadRequestException('Este serviço não é um banco de dados suportado (PostgreSQL/MySQL/MariaDB)');
    }

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');

    const secretKey = dbImportSecretKey(service.image);
    const secrets = deployment.secretsEnc
      ? (JSON.parse(decryptCredential(deployment.secretsEnc)) as Record<string, string>)
      : {};
    const password = secretKey ? secrets[secretKey] : undefined;
    if (!password) {
      throw new BadRequestException('Senha do banco não encontrada — esta implantação não gerou o segredo esperado.');
    }

    const variables = deployment.variablesJson ? (JSON.parse(deployment.variablesJson) as Record<string, string>) : {};
    const database = variables.DATABASE_NAME || 'app';

    const application = await this.prisma.application.findUnique({
      where: { id: service.applicationId },
      select: { serverId: true },
    });
    if (!application) throw new NotFoundException('Projeto não encontrado');
    const { options } = await this.servers.getServerWithConnectOptions(application.serverId);

    const inspect = await this.ssh.runCommand(
      options,
      `sudo docker inspect ${shellSingleQuote(service.containerName)} --format '{{(index .NetworkSettings.Networks "${PROXY_NETWORK}").IPAddress}}'`,
      15_000,
    );
    const containerIp = inspect.stdout.trim();
    if (!inspect.ok || !containerIp) {
      throw new BadRequestException('Não foi possível encontrar o container do banco na rede — confira se ele está rodando.');
    }

    const { stream, close } = await this.ssh.openTunnel(options, containerIp, enginePort(engine));
    try {
      if (engine === 'postgresql') {
        const client = new PgClient({ stream: stream as never, user: engineUser(engine), password, database });
        await client.connect();
        try {
          const conn: DbConnection = {
            async query(sql, params) {
              const result = await client.query(sql, params as unknown[]);
              return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? null };
            },
          };
          return await fn(conn, engine);
        } finally {
          await client.end();
        }
      }

      const connection = await createMysqlConnection({ stream: stream as never, user: engineUser(engine), password, database });
      try {
        const conn: DbConnection = {
          async query(sql, params) {
            const [result] = await connection.query(sql, params);
            if (Array.isArray(result)) {
              return { rows: result as Record<string, unknown>[], rowCount: result.length };
            }
            const info = result as { affectedRows?: number };
            return { rows: [], rowCount: info.affectedRows ?? null };
          },
        };
        return await fn(conn, engine);
      } finally {
        await connection.end();
      }
    } finally {
      close();
    }
  }
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: sem erros. Se `stream` reclamar de tipo entre `ssh2` (Duplex) e o que `mysql2`/`pg` esperam, o `as never` nos dois pontos de conexão já contorna isso (ambas as libs aceitam qualquer stream duplex compatível em runtime, só a tipagem de `@types` é que não modela a opção `stream` com precisão).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database-console/database-tunnel.service.ts
git commit -m "database-tunnel.service: conecta ao banco via túnel SSH + driver nativo"
```

---

### Task 6: `database-console.service.ts` — tabelas, linhas, SQL, histórico

**Files:**
- Create: `apps/api/src/database-console/database-console.service.ts`

**Interfaces:**
- Consumes: `DatabaseTunnelService.withConnection` e `DbConnection` (Task 5), `isKnownTable`/`paginate` (Task 4), `PrismaService`.
- Produces: `TableInfo`, `RowsResult`, `QueryExecResult`, `QueryLogEntry` e `DatabaseConsoleService` com `listTables`, `getRows`, `runQuery`, `listQueryLog` — usados pela Task 7.

- [ ] **Step 1: Escrever o serviço**

Criar `apps/api/src/database-console/database-console.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseTunnelService, type DbConnection } from './database-tunnel.service';
import { isKnownTable, paginate, type DbEngine } from './database-console.util';

export interface TableInfo {
  name: string;
  rowCount: number | null;
}

export interface RowsResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QueryExecResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number | null;
}

export interface QueryLogEntry {
  id: string;
  query: string;
  ok: boolean;
  rowCount: number | null;
  error: string | null;
  executedAt: Date;
  userName: string;
}

const PG_LIST_TABLES_SQL = `
  SELECT c.relname AS name, c.reltuples::bigint AS "rowCount"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
  ORDER BY c.relname
`;

const MYSQL_LIST_TABLES_SQL = `
  SELECT table_name AS name, table_rows AS rowCount
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
  ORDER BY table_name
`;

/**
 * Navegação de tabelas/linhas (só leitura) + editor SQL livre de um banco
 * gerenciado pelo Velix — a versão embutida do que o Adminer cobria, sem
 * sair da tela do banco. `rowCount` das tabelas é uma estimativa
 * (`reltuples`/`table_rows`), não `COUNT(*)` exato — mesma escolha do
 * Adminer, evita full scan só pra listar tabelas.
 */
@Injectable()
export class DatabaseConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tunnel: DatabaseTunnelService,
  ) {}

  private async fetchTables(conn: DbConnection, engine: DbEngine): Promise<TableInfo[]> {
    const sql = engine === 'postgresql' ? PG_LIST_TABLES_SQL : MYSQL_LIST_TABLES_SQL;
    const { rows } = await conn.query(sql);
    return rows.map((r) => ({
      name: String(r.name),
      rowCount: r.rowCount == null ? null : Number(r.rowCount),
    }));
  }

  private async listColumnNames(conn: DbConnection, engine: DbEngine, table: string): Promise<string[]> {
    const sql =
      engine === 'postgresql'
        ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`;
    const { rows } = await conn.query(sql, [table]);
    return rows.map((r) => String(r.name));
  }

  listTables(projectServiceId: string): Promise<TableInfo[]> {
    return this.tunnel.withConnection(projectServiceId, (conn, engine) => this.fetchTables(conn, engine));
  }

  getRows(
    projectServiceId: string,
    table: string,
    opts: { page: number; pageSize: number; search?: string },
  ): Promise<RowsResult> {
    return this.tunnel.withConnection(projectServiceId, async (conn, engine) => {
      const known = (await this.fetchTables(conn, engine)).map((t) => t.name);
      if (!isKnownTable(table, known)) {
        throw new BadRequestException(`Tabela "${table}" não existe neste banco.`);
      }
      const columns = await this.listColumnNames(conn, engine, table);
      const { limit, offset } = paginate(opts.page, opts.pageSize);

      let whereClause = '';
      let whereParams: unknown[] = [];
      const search = opts.search?.trim();
      if (search && columns.length > 0) {
        const needle = `%${search}%`;
        if (engine === 'postgresql') {
          whereClause = `WHERE ${columns.map((c) => `"${c}"::text ILIKE $1`).join(' OR ')}`;
          whereParams = [needle];
        } else {
          whereClause = `WHERE ${columns.map((c) => `CAST(\`${c}\` AS CHAR) LIKE ?`).join(' OR ')}`;
          whereParams = columns.map(() => needle);
        }
      }

      const tableIdent = engine === 'postgresql' ? `"${table}"` : `\`${table}\``;
      const { rows: countRows } = await conn.query(`SELECT COUNT(*) AS total FROM ${tableIdent} ${whereClause}`, whereParams);
      const total = Number(countRows[0]?.total ?? 0);

      const dataSql =
        engine === 'postgresql'
          ? `SELECT * FROM ${tableIdent} ${whereClause} LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
          : `SELECT * FROM ${tableIdent} ${whereClause} LIMIT ? OFFSET ?`;
      const { rows } = await conn.query(dataSql, [...whereParams, limit, offset]);

      return { columns, rows, total, page: opts.page, pageSize: opts.pageSize };
    });
  }

  async runQuery(projectServiceId: string, userId: string, sql: string): Promise<QueryExecResult> {
    const trimmed = sql.trim();
    if (!trimmed) throw new BadRequestException('Informe um comando SQL.');

    try {
      const result = await this.tunnel.withConnection(projectServiceId, (conn) => conn.query(trimmed));
      await this.prisma.databaseQueryLog.create({
        data: { projectServiceId, userId, query: trimmed, ok: true, rowCount: result.rowCount },
      });
      const columns = result.rows[0] ? Object.keys(result.rows[0]) : [];
      return {
        columns,
        rows: result.rows,
        rowsAffected: result.rows.length === 0 ? result.rowCount : null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao executar o comando';
      await this.prisma.databaseQueryLog.create({
        data: { projectServiceId, userId, query: trimmed, ok: false, error: message },
      });
      throw new BadRequestException(message);
    }
  }

  async listQueryLog(projectServiceId: string): Promise<QueryLogEntry[]> {
    const rows = await this.prisma.databaseQueryLog.findMany({
      where: { projectServiceId },
      orderBy: { executedAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      query: r.query,
      ok: r.ok,
      rowCount: r.rowCount,
      error: r.error,
      executedAt: r.executedAt,
      userName: r.user.name,
    }));
  }
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database-console/database-console.service.ts
git commit -m "database-console.service: listar tabelas/linhas, rodar SQL e histórico"
```

---

### Task 7: Controller + módulo + `AppModule`

**Files:**
- Create: `apps/api/src/database-console/dto/run-query.dto.ts`
- Create: `apps/api/src/database-console/database-console.controller.ts`
- Create: `apps/api/src/database-console/database-console.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `DatabaseConsoleService` (Task 6), `JwtAuthGuard`/`RolesGuard`/`MinRole` (`../auth/*`), `AuthenticatedUser` (`../auth/jwt-auth.guard`).
- Produces: rotas HTTP `GET/POST /databases/:id/tables`, `/tables/:table/rows`, `/query`, `/query-log`.

- [ ] **Step 1: DTO da query**

Criar `apps/api/src/database-console/dto/run-query.dto.ts`:

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class RunQueryDto {
  @IsString()
  @IsNotEmpty()
  sql!: string;
}
```

- [ ] **Step 2: Controller**

Criar `apps/api/src/database-console/database-console.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { DatabaseConsoleService } from './database-console.service';
import { RunQueryDto } from './dto/run-query.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

// Mesmo prefixo 'databases' de DatabaseBackupController — rotas não colidem
// porque cada uma declara um caminho de método diferente
// (:id/tables, :id/tables/:table/rows, :id/query, :id/query-log).
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseConsoleController {
  constructor(private readonly console: DatabaseConsoleService) {}

  @Get(':id/tables')
  listTables(@Param('id') id: string) {
    return this.console.listTables(id);
  }

  @Get(':id/tables/:table/rows')
  getRows(
    @Param('id') id: string,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.console.getRows(id, table, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      search,
    });
  }

  @Post(':id/query')
  @MinRole('operator')
  runQuery(@Param('id') id: string, @Body() dto: RunQueryDto, @Req() req: AuthedRequest) {
    return this.console.runQuery(id, req.user.sub, dto.sql);
  }

  @Get(':id/query-log')
  listQueryLog(@Param('id') id: string) {
    return this.console.listQueryLog(id);
  }
}
```

- [ ] **Step 3: Módulo**

Criar `apps/api/src/database-console/database-console.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { DatabaseConsoleController } from './database-console.controller';
import { DatabaseConsoleService } from './database-console.service';
import { DatabaseTunnelService } from './database-tunnel.service';

@Module({
  // AuthModule (guards) e ServersModule (SshService/ServersService) — mesmo
  // motivo documentado em DatabaseBackupModule: sem AuthModule aqui, o Nest
  // não resolve JwtAuthGuard/RolesGuard por DI.
  imports: [AuthModule, ServersModule],
  controllers: [DatabaseConsoleController],
  providers: [DatabaseConsoleService, DatabaseTunnelService],
})
export class DatabaseConsoleModule {}
```

- [ ] **Step 4: Registrar no `AppModule`**

Em `apps/api/src/app.module.ts`, adicionar o import:

```ts
import { DatabaseConsoleModule } from './database-console/database-console.module';
```

E na lista `imports`, logo depois de `DatabaseBackupModule`:

```ts
    DatabaseConsoleModule,
```

- [ ] **Step 5: Verificação completa do backend**

```bash
cd apps/api && npx tsc --noEmit && npx nest build && npx ts-node src/app.module.spec.ts
```

Expected: os três comandos terminam sem erro; o último imprime `✓ app.module self-check OK — todos os módulos resolvem suas dependências`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database-console/dto/run-query.dto.ts apps/api/src/database-console/database-console.controller.ts apps/api/src/database-console/database-console.module.ts apps/api/src/app.module.ts
git commit -m "Expõe o console de banco embutido: GET/POST /databases/:id/tables,rows,query,query-log"
```

---

### Task 8: Tipos do frontend

**Files:**
- Modify: `apps/web/lib/types.ts`

**Interfaces:**
- Produces: `DatabaseTableInfo`, `DatabaseRowsResult`, `DatabaseQueryResult`, `DatabaseQueryLogEntry` — usados pela Task 9.

- [ ] **Step 1: Adicionar os tipos**

Em `apps/web/lib/types.ts`, adicionar (perto de `DatabaseBackupRun`/`BackupDestinationSummary`, mesma vizinhança temática):

```ts
export interface DatabaseTableInfo {
  name: string;
  rowCount: number | null;
}

export interface DatabaseRowsResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DatabaseQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number | null;
}

export interface DatabaseQueryLogEntry {
  id: string;
  query: string;
  ok: boolean;
  rowCount: number | null;
  error: string | null;
  executedAt: string;
  userName: string;
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/types.ts
git commit -m "Tipos frontend do console de banco embutido"
```

---

### Task 9: `DatabaseDataTab.tsx` — componente da aba "Dados"

**Files:**
- Create: `apps/web/components/DatabaseDataTab.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`@/lib/api`), `DatabaseTableInfo`/`DatabaseRowsResult`/`DatabaseQueryResult`/`DatabaseQueryLogEntry` (Task 8), `Alert`/`Skeleton`/`StatusBadge` (já existentes), `IconLayers`/`IconSearch`/`IconTerminal`/`IconClock`/`IconChevronDown` (já existentes em `components/icons.tsx`).
- Produces: `<DatabaseDataTab databaseId={string} />` — usado pela Task 10.

- [ ] **Step 1: Escrever o componente**

Criar `apps/web/components/DatabaseDataTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { DatabaseTableInfo, DatabaseRowsResult, DatabaseQueryResult, DatabaseQueryLogEntry } from '@/lib/types';
import { Alert } from './Alert';
import { Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { IconLayers, IconSearch, IconTerminal, IconClock, IconChevronDown } from './icons';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-slate-500">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-center text-sm text-slate-400">Nenhuma linha encontrada.</p>}
    </div>
  );
}

export function DatabaseDataTab({ databaseId }: { databaseId: string }) {
  const [tables, setTables] = useState<DatabaseTableInfo[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [rowsResult, setRowsResult] = useState<DatabaseRowsResult | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const [showSqlEditor, setShowSqlEditor] = useState(false);
  const [sqlText, setSqlText] = useState('');
  const [runningSql, setRunningSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<DatabaseQueryResult | { error: string } | null>(null);
  const [queryLog, setQueryLog] = useState<DatabaseQueryLogEntry[] | null>(null);

  useEffect(() => {
    apiFetch<DatabaseTableInfo[]>(`/databases/${databaseId}/tables`)
      .then(setTables)
      .catch((e) => setTablesError(e instanceof Error ? e.message : 'Falha ao carregar tabelas'));
    loadQueryLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  useEffect(() => {
    if (!selectedTable) return;
    setLoadingRows(true);
    setRowsError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (search.trim()) params.set('search', search.trim());
    apiFetch<DatabaseRowsResult>(`/databases/${databaseId}/tables/${encodeURIComponent(selectedTable)}/rows?${params}`)
      .then(setRowsResult)
      .catch((e) => setRowsError(e instanceof Error ? e.message : 'Falha ao carregar linhas'))
      .finally(() => setLoadingRows(false));
  }, [databaseId, selectedTable, page, search]);

  function loadQueryLog() {
    apiFetch<DatabaseQueryLogEntry[]>(`/databases/${databaseId}/query-log`)
      .then(setQueryLog)
      .catch(() => {});
  }

  function selectTable(name: string) {
    setSelectedTable(name);
    setPage(1);
    setSearch('');
  }

  async function runSql() {
    setRunningSql(true);
    setSqlResult(null);
    try {
      const result = await apiFetch<DatabaseQueryResult>(`/databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql: sqlText }),
      });
      setSqlResult(result);
    } catch (e) {
      setSqlResult({ error: e instanceof Error ? e.message : 'Falha ao executar o comando' });
    } finally {
      setRunningSql(false);
      loadQueryLog();
    }
  }

  const totalPages = rowsResult ? Math.max(1, Math.ceil(rowsResult.total / rowsResult.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <div className="card p-3">
          <p className="section-label mb-2 flex items-center gap-1.5">
            <IconLayers className="h-3.5 w-3.5" aria-hidden />
            Tabelas
          </p>
          {tablesError ? (
            <Alert variant="error">{tablesError}</Alert>
          ) : !tables ? (
            <Skeleton className="h-32" />
          ) : tables.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma tabela ainda.</p>
          ) : (
            <div className="space-y-0.5">
              {tables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => selectTable(t.name)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                    selectedTable === t.name
                      ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{t.rowCount ?? '—'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-3 p-4">
          {!selectedTable ? (
            <p className="text-sm text-slate-400">Selecione uma tabela pra ver os dados.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="section-label">{selectedTable}</p>
                <div className="relative">
                  <IconSearch
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar..."
                    className="input h-8 w-48 pl-8 text-xs"
                  />
                </div>
              </div>
              {rowsError && <Alert variant="error">{rowsError}</Alert>}
              {loadingRows ? (
                <Skeleton className="h-40" />
              ) : (
                rowsResult && (
                  <>
                    <DataTable columns={rowsResult.columns} rows={rowsResult.rows} />
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {rowsResult.total} linha{rowsResult.total === 1 ? '' : 's'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="btn-secondary px-2 py-1 disabled:opacity-40"
                        >
                          Anterior
                        </button>
                        <span>
                          Página {page} de {totalPages}
                        </span>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="btn-secondary px-2 py-1 disabled:opacity-40"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <button onClick={() => setShowSqlEditor((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="section-label flex items-center gap-1.5">
            <IconTerminal className="h-3.5 w-3.5" aria-hidden />
            Editor SQL
          </span>
          <IconChevronDown className={`h-4 w-4 text-slate-400 transition ${showSqlEditor ? 'rotate-180' : ''}`} aria-hidden />
        </button>

        {showSqlEditor && (
          <>
            <textarea
              value={sqlText}
              onChange={(e) => setSqlText(e.target.value)}
              rows={5}
              placeholder="SELECT * FROM ..."
              className="input font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-400">
                Roda com o usuário administrador do banco — cuidado com UPDATE/DELETE sem WHERE.
              </p>
              <button onClick={runSql} disabled={runningSql || !sqlText.trim()} className="btn-primary shrink-0 px-3.5 py-1.5 text-sm disabled:opacity-50">
                {runningSql ? 'Executando...' : 'Executar'}
              </button>
            </div>

            {sqlResult && 'error' in sqlResult && <Alert variant="error">{sqlResult.error}</Alert>}
            {sqlResult &&
              'columns' in sqlResult &&
              (sqlResult.rowsAffected != null ? (
                <Alert variant="success">{sqlResult.rowsAffected} linha(s) afetada(s).</Alert>
              ) : (
                <DataTable columns={sqlResult.columns} rows={sqlResult.rows} />
              ))}

            {queryLog && queryLog.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                  <IconClock className="h-3.5 w-3.5" aria-hidden />
                  Histórico
                </p>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                  {queryLog.map((q) => (
                    <div key={q.id} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-slate-700 dark:text-slate-200">{q.query}</span>
                        <StatusBadge tone={q.ok ? 'success' : 'danger'}>{q.ok ? 'ok' : 'erro'}</StatusBadge>
                      </div>
                      <p className="mt-0.5 text-slate-400">
                        {q.userName} · {new Date(q.executedAt).toLocaleString('pt-BR')}
                        {q.rowCount != null ? ` · ${q.rowCount} linha(s)` : ''}
                      </p>
                      {!q.ok && q.error && <p className="mt-0.5 truncate text-red-500 dark:text-red-400">{q.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/DatabaseDataTab.tsx
git commit -m "DatabaseDataTab: navegação de tabelas/linhas + editor SQL + histórico"
```

---

### Task 10: Wire — aba "Dados" em `databases/[id]/page.tsx`

**Files:**
- Modify: `apps/web/app/(dashboard)/databases/[id]/page.tsx`

**Interfaces:**
- Consumes: `DatabaseDataTab` (Task 9).

- [ ] **Step 1: Trocar o import do Adminer pelo novo componente**

Em `apps/web/app/(dashboard)/databases/[id]/page.tsx`, trocar:

```ts
import { AdminerDeployButton } from '@/components/AdminerDeployButton';
```

por:

```ts
import { DatabaseDataTab } from '@/components/DatabaseDataTab';
```

- [ ] **Step 2: Remover o botão do Adminer da seção Conexão**

Trocar:

```tsx
        <div className="flex flex-wrap gap-2 pt-1">
          <SqlImportButton
            applicationId={project.id}
            serviceName={service.name}
            image={service.image}
            serverId={project.server.id}
          />
          <AdminerDeployButton project={project} containerName={service.containerName} onChange={load} />
        </div>
```

por:

```tsx
        <div className="flex flex-wrap gap-2 pt-1">
          <SqlImportButton
            applicationId={project.id}
            serviceName={service.name}
            image={service.image}
            serverId={project.server.id}
          />
        </div>
```

- [ ] **Step 3: Introduzir abas e a aba "Dados"**

Trocar o container externo (`max-w-3xl` → `max-w-6xl`, mais largo pra caber a grade de duas colunas) e adicionar a navegação por abas. Trocar:

```tsx
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Breadcrumb items={[{ label: 'Bancos de Dados', href: '/databases' }, { label: project.name }]} />
        <div className="mt-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
            <IconDatabase className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="page-title">{project.name}</h1>
            <p className="text-xs text-slate-400">{engineLabel(service.image)}</p>
          </div>
          <StatusBadge tone={STATUS_TONE[service.status] ?? 'neutral'}>{service.status}</StatusBadge>
        </div>
      </div>

      <div className="card space-y-3 p-4">
```

por:

```tsx
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <Breadcrumb items={[{ label: 'Bancos de Dados', href: '/databases' }, { label: project.name }]} />
        <div className="mt-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
            <IconDatabase className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="page-title">{project.name}</h1>
            <p className="text-xs text-slate-400">{engineLabel(service.image)}</p>
          </div>
          <StatusBadge tone={STATUS_TONE[service.status] ?? 'neutral'}>{service.status}</StatusBadge>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {(['conexao', 'dados', 'backups'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {key === 'conexao' ? 'Conexão' : key === 'dados' ? 'Dados' : 'Backups'}
          </button>
        ))}
      </div>

      {tab === 'conexao' && (
      <div className="card space-y-3 p-4">
```

- [ ] **Step 4: Fechar a condicional da aba Conexão e adicionar as abas Dados/Backups**

Trocar o fim do bloco Conexão + `<BackupSection .../>`:

```tsx
        <PublishPortControl
          applicationId={project.id}
          serviceName={service.name}
          publishedPort={service.publishedPort}
          onChange={load}
        />
      </div>

      <BackupSection databaseId={databaseId} serverId={project.server.id} />
    </div>
  );
}
```

por:

```tsx
        <PublishPortControl
          applicationId={project.id}
          serviceName={service.name}
          publishedPort={service.publishedPort}
          onChange={load}
        />
      </div>
      )}

      {tab === 'dados' && <DatabaseDataTab databaseId={databaseId} />}

      {tab === 'backups' && <BackupSection databaseId={databaseId} serverId={project.server.id} />}
    </div>
  );
}
```

- [ ] **Step 5: Declarar o estado `tab`**

No topo do componente `DatabaseDetailPage`, junto dos outros `useState`, adicionar:

```ts
  const [tab, setTab] = useState<'conexao' | 'dados' | 'backups'>('conexao');
```

- [ ] **Step 6: Verificar que compila**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros — nenhuma referência a `AdminerDeployButton` deve sobrar neste arquivo (`grep -n "AdminerDeployButton" "apps/web/app/(dashboard)/databases/[id]/page.tsx"` não deve devolver nada).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(dashboard)/databases/[id]/page.tsx"
git commit -m "databases/[id]: aba Dados embutida substitui o botão do Adminer"
```

---

### Task 11: Remover o Adminer da tela genérica de serviço

**Files:**
- Modify: `apps/web/app/(dashboard)/projects/[id]/services/[name]/page.tsx`

**Interfaces:**
- Nenhuma nova — só remoção + um link de navegação pro `/databases/[id]` já existente.

- [ ] **Step 1: Remover o import do Adminer**

Trocar:

```ts
import { AdminerDeployButton } from '@/components/AdminerDeployButton';
```

Remover a linha inteira (sem substituto — este arquivo não ganha a aba Dados, só perde o botão do Adminer; navegação de dados acontece pela aba "Bancos de Dados" dedicada).

- [ ] **Step 2: Trocar o botão do Adminer por um link pra tela dedicada**

Em `OverviewTab`, trocar:

```tsx
            <AdminerDeployButton project={project} containerName={service.containerName} onChange={onChange} />
          </div>
```

por:

```tsx
            <a href={`/databases/${service.id}`} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
              <IconGlobe className="h-4 w-4" aria-hidden />
              Gerenciar dados
            </a>
          </div>
```

(`IconGlobe` já está importado neste arquivo — usado em vários outros pontos da mesma tela.)

- [ ] **Step 3: Verificar que compila**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros — `grep -rn "AdminerDeployButton" "apps/web/app/(dashboard)/projects/[id]/services/[name]/page.tsx"` não deve devolver nada.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/projects/[id]/services/[name]/page.tsx"
git commit -m "Tela de serviço: link pra Bancos de Dados no lugar do botão do Adminer"
```

---

### Task 12: Verificação final completa

**Files:** nenhum (só verificação).

- [ ] **Step 1: Backend**

```bash
cd apps/api && npx tsc --noEmit && npx nest build && npx ts-node src/app.module.spec.ts && npx ts-node src/database-console/database-console.util.spec.ts
```

Expected: todos passam limpos.

- [ ] **Step 2: Frontend**

```bash
cd apps/web && npx tsc --noEmit && npx next build
```

Expected: build termina com `✓ Compiled successfully` e sem erro de tipos.

- [ ] **Step 3: Checar que nenhum ponto de entrada do Adminer sobrou na UI**

```bash
grep -rln "AdminerDeployButton" apps/web/app
```

Expected: nenhum resultado (o componente `apps/web/components/AdminerDeployButton.tsx` continua existindo no repositório, só sem uso — remoção do arquivo é limpeza separada, fora de escopo).

---

### Task 13: Versão, commit final e release

**Files:**
- Modify: `apps/api/VERSION`

- [ ] **Step 1: Bump de versão**

Ler `apps/api/VERSION` (versão atual nesta sessão: `1.18.2`) e trocar pra `1.19.0` (minor — feature nova, não é um bugfix).

- [ ] **Step 2: Commit**

```bash
git add apps/api/VERSION
git commit -m "$(cat <<'EOF'
Gerenciador de banco de dados embutido — substitui o Adminer

Nova aba "Dados" na página de cada banco: navega tabelas e linhas (só
leitura, paginado, com busca) e roda SQL livre com histórico de execuções
(quem, quando, o quê, resultado) — tudo sem sair do Velix e sem tela de
login (autentica sozinho com a senha root já gerada no deploy).

Conecta via túnel SSH efêmero (reaproveita a infra SSH já existente) até
o container na rede velix-proxy, usando os drivers nativos mysql2/pg —
substitui o fluxo do Adminer + domínio automático (v1.17.3-v1.18.2), que
tinha sido a origem de vários bugs nesta sessão (constraint única, status
de domínio enganoso). O botão do Adminer sai de todas as telas; o
componente/manifesto ficam no repositório sem ponto de entrada.

Testado: tsc --noEmit, nest build, self-check de DI e do util novo
(apps/api); tsc --noEmit, next build (apps/web) — todos limpos. NÃO
testado: túnel SSH + driver contra um banco real (sem Docker/servidor
neste ambiente) — é a parte de maior risco desta entrega, testar contra
PostgreSQL e MySQL/MariaDB reais antes de confiar em produção.
EOF
)"
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Release**

```bash
gh release create v1.19.0 --title "v1.19.0" --notes "$(cat <<'EOF'
## Gerenciador de banco de dados embutido

Nova aba **"Dados"** na página de cada banco — substitui o botão "Abrir
interface web" (Adminer):

- Lista as tabelas com contagem de linhas, navega os dados paginados e com
  busca — tudo dentro do Velix, sem abrir outra página.
- Editor SQL livre pra qualquer comando (SELECT, UPDATE, INSERT, DELETE
  manual), com histórico de tudo que já foi executado: quem rodou, quando,
  o quê e se deu certo.
- Sem tela de login — conecta sozinho com a senha do banco já gerada na
  criação.

O Adminer e o domínio automático saem de todas as telas.
EOF
)"
```

---

## Self-Review

**Cobertura da spec:** objetivo (navegar tabelas/linhas + SQL + histórico) → Tasks 6/9; autenticação automática → Task 5; túnel SSH → Tasks 3/5; três motores → `resolveEngine`/`enginePort`/`engineUser` (Task 4) usados em Task 5/6; remoção do Adminer → Tasks 10/11; segurança (validação de nome de tabela, `@MinRole('operator')` em `/query`, túnel sempre fechado no `finally`) → Tasks 4-7; modelo de dados do histórico → Task 2.

**Fora de escopo confirmado, sem task correspondente (intencional):** edição célula-a-célula, gerenciar usuários/privilégios do banco, trocar de schema, múltiplas conexões simultâneas, log de atividade do sistema inteiro (projeto separado).

**Consistência de tipos:** `DbConnection`/`DbEngine` (Task 4/5) usados sem mudança de nome nas Tasks 6/7; `TableInfo`/`RowsResult`/`QueryExecResult`/`QueryLogEntry` (Task 6, backend) espelham `DatabaseTableInfo`/`DatabaseRowsResult`/`DatabaseQueryResult`/`DatabaseQueryLogEntry` (Task 8, frontend) campo a campo.
