# Aba "Bancos de Dados" + Backup (FTP/SFTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma aba "Bancos de Dados" própria na barra lateral, separada de "Projetos", que lista todo banco Postgres/MySQL/MariaDB gerenciado (reaproveitando o modelo de Projetos já existente, sem sistema paralelo), com criação curta, página dedicada por banco, e backup manual + agendado com upload opcional pra um servidor via FTP ou SFTP.

**Architecture:** A aba nova é uma visão filtrada sobre `ProjectService`/`ProjectDeployment`/`Application` já existentes — nenhuma entidade nova representa "o banco em si". Três tabelas novas cobrem só o que não existe hoje: `BackupDestination` (conexão FTP/SFTP salva), `DatabaseBackupConfig` (agendamento por banco) e `DatabaseBackupRun` (histórico). Um módulo novo, `src/database-backup/`, concentra toda a lógica nova; nada do módulo `applications` ou do módulo órfão `database` é alterado.

**Tech Stack:** NestJS + Prisma (Postgres) na API, Next.js 14 (App Router) + Tailwind no frontend, `ssh2` (já em uso) pra SFTP, `basic-ftp` (dependência nova) pra FTP, `@nestjs/schedule` (já em uso) pro agendamento.

## Global Constraints

- Motores cobertos: Postgres, MySQL, MariaDB — mesmo escopo já usado por "Importar .sql" (v1.14.0). Mongo/Redis não aparecem na aba nova.
- Toda migração Prisma nesta entrega é só `CREATE TABLE`/`ADD COLUMN`/`ALTER TABLE ADD COLUMN` — nunca `ALTER TYPE` na mesma transação que usa o valor novo (lição da v1.11.0, ver `apps/api/prisma/migrations/`).
- Todo valor que entra numa string executada via `SshService.runCommand` (nome de banco, senha, caminho remoto) passa por `shellSingleQuote` antes — lição da v1.15.2 (injeção de comando real encontrada e corrigida no `dbImportCommand`).
- Credencial de `BackupDestination` cifrada com `encryptCredential`/`decryptCredential` (AES-256-GCM, `apps/api/src/ssh/crypto.util.ts`) — mesmo padrão de `GitAccount.tokenEnc`/`Server.credentialEnc`. Nunca volta em claro em nenhuma resposta de API.
- Mutações exigem `@MinRole('operator')` (criar/remover destino, configurar agendamento, disparar backup manual); leitura exige só `JwtAuthGuard`. Mesma convenção de toda a API.
- Toda função pura nova ganha um `*.util.spec.ts` rodável via `npx ts-node` (sem framework de teste) — mesmo padrão de `container-shell.util.spec.ts`/`git-source.util.spec.ts`.
- Ao final: `npx tsc --noEmit` + `npx nest build` na API, `npx ts-node src/app.module.spec.ts` (checagem de DI), todos os `*.util.spec.ts` tocados, `npx tsc --noEmit` + `npx next build` no frontend — nenhuma claim de "funciona" sem essas saídas limpas na frente.

---

## Task 1: Modelo de dados — migração Prisma

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260808170000_database_backups/migration.sql`

**Interfaces:**
- Produces: models `BackupDestination`, `DatabaseBackupConfig`, `DatabaseBackupRun`; campos `ProjectService.backupConfig` (1:1 opcional) e `ProjectService.backupRuns` (1:N).

- [ ] **Step 1: Adicionar os models novos ao schema**

Abrir `apps/api/prisma/schema.prisma`, achar o bloco `model ProjectService { ... }` (por volta da linha 476) e adicionar as duas relações inversas dentro dele, logo após o campo `updatedAt`:

```prisma
  backupConfig    DatabaseBackupConfig?
  backupRuns      DatabaseBackupRun[]
```

Logo depois do fechamento do `model ProjectService`, adicionar os três models novos:

```prisma
/// Conexão FTP/SFTP salva pra onde um backup de banco pode ser enviado —
/// configurada uma vez em Configurações, reaproveitável por vários bancos
/// (mesmo padrão de GitAccount pra contas de forja).
model BackupDestination {
  id            String   @id @default(uuid())
  label         String
  /// "ftp" | "sftp"
  protocol      String
  host          String
  port          Int
  username      String
  /// Cifrado com o mesmo padrão AES-256-GCM já usado em GitAccount/Server.
  credentialEnc String
  remotePath    String   @default("/")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  backupConfigs DatabaseBackupConfig[]
}

/// Agendamento de backup de UM banco (ProjectService) — 1:1, cada banco tem
/// no máximo uma configuração.
model DatabaseBackupConfig {
  id               String   @id @default(uuid())
  projectServiceId String   @unique
  projectService   ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)

  /// "HH:mm" (fuso do servidor da API) — null = sem agendamento automático, só manual.
  scheduledAt      String?
  retentionDays    Int      @default(14)

  destinationId    String?
  destination      BackupDestination? @relation(fields: [destinationId], references: [id], onDelete: SetNull)

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

/// Histórico de execuções de backup de um banco — mesmo padrão do BackupRun
/// já usado pro backup do próprio Velix (apps/api/prisma/schema.prisma, model BackupRun).
model DatabaseBackupRun {
  id               String   @id @default(uuid())
  projectServiceId String
  projectService   ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)

  /// "scheduled" | "manual"
  trigger          String
  /// "RUNNING" | "SUCCESS" | "ERROR"
  status           String
  fileName         String?
  sizeBytes        Int?
  uploadedRemote   Boolean  @default(false)
  error            String?
  startedAt        DateTime @default(now())
  finishedAt       DateTime?

  @@index([projectServiceId])
}
```

- [ ] **Step 2: Escrever a migração à mão**

Criar o diretório e o arquivo:

```bash
mkdir -p apps/api/prisma/migrations/20260808170000_database_backups
```

Criar `apps/api/prisma/migrations/20260808170000_database_backups/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "BackupDestination" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "credentialEnc" TEXT NOT NULL,
    "remotePath" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseBackupConfig" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "scheduledAt" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 14,
    "destinationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseBackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseBackupRun" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "uploadedRemote" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DatabaseBackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseBackupConfig_projectServiceId_key" ON "DatabaseBackupConfig"("projectServiceId");

-- CreateIndex
CREATE INDEX "DatabaseBackupRun_projectServiceId_idx" ON "DatabaseBackupRun"("projectServiceId");

-- AddForeignKey
ALTER TABLE "DatabaseBackupConfig" ADD CONSTRAINT "DatabaseBackupConfig_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseBackupConfig" ADD CONSTRAINT "DatabaseBackupConfig_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "BackupDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseBackupRun" ADD CONSTRAINT "DatabaseBackupRun_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Gerar o Prisma Client e verificar**

```bash
cd apps/api && npx prisma generate
```

Expected: `✔ Generated Prisma Client` sem erro. Isso NÃO aplica a migração num banco (sem Postgres neste ambiente) — só regenera os tipos TS a partir do `schema.prisma`, que é o suficiente pro resto do plano compilar.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260808170000_database_backups/
git commit -m "Modelo de dados: BackupDestination, DatabaseBackupConfig, DatabaseBackupRun"
```

---

## Task 2: Funções puras do backup (`database-backup.util.ts`)

**Files:**
- Create: `apps/api/src/database-backup/database-backup.util.ts`
- Create: `apps/api/src/database-backup/database-backup.util.spec.ts`

**Interfaces:**
- Consumes: `shellSingleQuote` de `apps/api/src/database/mysql.util.ts` (já existe).
- Produces: `dumpCommand(image: string, password: string, dbName: string): { execFlags: string; command: string } | null`, `isManagedDatabaseImage(image: string): boolean`, `backupFileName(serviceName: string): string`.

- [ ] **Step 1: Escrever o self-check ANTES da implementação (falha esperada)**

Criar `apps/api/src/database-backup/database-backup.util.spec.ts`:

```ts
/**
 * Self-check das funções puras de backup de banco — sem framework:
 *   npx ts-node src/database-backup/database-backup.util.spec.ts
 */
import assert from 'node:assert';
import { dumpCommand, isManagedDatabaseImage, backupFileName } from './database-backup.util';

// --- isManagedDatabaseImage ---------------------------------------------------
assert.equal(isManagedDatabaseImage('postgres:16.4'), true);
assert.equal(isManagedDatabaseImage('mysql:8.4'), true);
assert.equal(isManagedDatabaseImage('mariadb:11.4'), true);
assert.equal(isManagedDatabaseImage('POSTGRES:16'), true, 'case-insensitive');
assert.equal(isManagedDatabaseImage('mongo:7'), false, 'mongo fora do escopo de backup');
assert.equal(isManagedDatabaseImage('redis:7-alpine'), false);
assert.equal(isManagedDatabaseImage('nginx:alpine'), false);

// --- dumpCommand ---------------------------------------------------------------
const pg = dumpCommand('postgres:16.4', "senha'com'aspas", 'app');
assert.ok(pg);
assert.equal(pg!.command, "pg_dump -U postgres -d 'app' --no-owner --no-privileges");
assert.ok(pg!.execFlags.startsWith('-e PGPASSWORD='), 'postgres passa a senha por variável de ambiente do exec');
assert.ok(!/PGPASSWORD=senha'com/.test(pg!.execFlags), 'senha com aspa simples não pode quebrar o comando');

const mysql = dumpCommand('mysql:8.4', 'segredo', 'app');
assert.ok(mysql);
assert.equal(mysql!.execFlags, '');
assert.equal(mysql!.command, "mysqldump -uroot -p'segredo' 'app'");

const mariadb = dumpCommand('mariadb:11.4', 'segredo', 'app');
assert.ok(mariadb);
assert.equal(mariadb!.command, "mysqldump -uroot -p'segredo' 'app'");

assert.equal(dumpCommand('mongo:7', 'x', 'app'), null);
assert.equal(dumpCommand('nginx:alpine', 'x', 'app'), null);

// nome de banco malicioso não pode escapar da aspa simples — mesma lição da
// injeção real encontrada em dbImportCommand (v1.15.2)
const injected = dumpCommand('postgres:16', 'pw', "app'; rm -rf / #");
assert.ok(injected);
assert.equal(injected!.command, "pg_dump -U postgres -d 'app'\\''; rm -rf / #' --no-owner --no-privileges");

// --- backupFileName --------------------------------------------------------
const name1 = backupFileName('db');
assert.ok(/^db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/.test(name1), `formato inesperado: ${name1}`);
// dois nomes gerados em sequência não colidem no mesmo milissegundo (timestamp completo, não só data)
assert.notEqual(backupFileName('db'), backupFileName('db'));

console.log('database-backup.util self-check OK');
```

- [ ] **Step 2: Rodar e confirmar que falha (arquivo de implementação não existe ainda)**

```bash
cd apps/api && npx ts-node src/database-backup/database-backup.util.spec.ts
```

Expected: erro `Cannot find module './database-backup.util'`.

- [ ] **Step 3: Implementar**

Criar `apps/api/src/database-backup/database-backup.util.ts`:

```ts
/** Funções puras do backup de banco de dados — sem I/O, testáveis sem
 * servidor. Ver database-backup.util.spec.ts. Irmã de
 * `terminal/container-shell.util.ts` (que cobre import, não export). */
import { shellSingleQuote } from '../database/mysql.util';

const MANAGED_ENGINES = ['postgres', 'mysql', 'mariadb'];

/** Mesmo escopo de `dbImportSecretKey`/`supportsSqlImport` — só bancos com
 * dump/restauração via `.sql` e senha em local previsível. */
export function isManagedDatabaseImage(image: string): boolean {
  const img = image.toLowerCase();
  return MANAGED_ENGINES.some((needle) => img.includes(needle));
}

/**
 * Comando do dump (sem o `docker exec` em volta, sem o redirecionamento pro
 * arquivo — isso é montado por quem chama, mesmo padrão de `dbImportCommand`).
 * `dbName` é uma variável de deploy digitada pelo usuário — protegida com
 * `shellSingleQuote` como qualquer outro valor que entra num comando remoto.
 */
export function dumpCommand(image: string, password: string, dbName: string): { execFlags: string; command: string } | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) {
    return {
      execFlags: `-e PGPASSWORD=${shellSingleQuote(password)}`,
      command: `pg_dump -U postgres -d ${shellSingleQuote(dbName)} --no-owner --no-privileges`,
    };
  }
  if (img.includes('mysql') || img.includes('mariadb')) {
    return { execFlags: '', command: `mysqldump -uroot -p${shellSingleQuote(password)} ${shellSingleQuote(dbName)}` };
  }
  return null;
}

/** Nome de arquivo com timestamp completo (não só data) — dois backups do
 * mesmo banco no mesmo dia não podem colidir. */
export function backupFileName(serviceName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${serviceName}-${stamp}.sql.gz`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx ts-node src/database-backup/database-backup.util.spec.ts
```

Expected: `database-backup.util self-check OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database-backup/database-backup.util.ts apps/api/src/database-backup/database-backup.util.spec.ts
git commit -m "Funções puras do backup de banco (dumpCommand, isManagedDatabaseImage)"
```

---

## Task 3: `BackupDestination` — CRUD

**Files:**
- Create: `apps/api/src/database-backup/dto/create-backup-destination.dto.ts`
- Create: `apps/api/src/database-backup/backup-destinations.service.ts`
- Create: `apps/api/src/database-backup/backup-destinations.controller.ts`

**Interfaces:**
- Consumes: `encryptCredential`/`decryptCredential` de `../ssh/crypto.util`, `PrismaService`.
- Produces: `BackupDestinationsService.list()`, `.create(dto)`, `.remove(id)`, `.resolveConnection(id): Promise<{host,port,username,password,remotePath}>` (usado pelo Task 4 pra montar a conexão SFTP/FTP real — nunca expõe a senha em texto puro fora daqui).

- [ ] **Step 1: DTO**

Criar `apps/api/src/database-backup/dto/create-backup-destination.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, Max, MinLength, Min } from 'class-validator';

export class CreateBackupDestinationDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsIn(['ftp', 'sftp'])
  protocol!: 'ftp' | 'sftp';

  @IsString()
  @MinLength(1)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  remotePath?: string;
}
```

- [ ] **Step 2: Service**

Criar `apps/api/src/database-backup/backup-destinations.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CreateBackupDestinationDto } from './dto/create-backup-destination.dto';

export interface ResolvedDestination {
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

/**
 * Conexões FTP/SFTP salvas pra onde backup de banco pode ser enviado —
 * mesmo padrão de credencial cifrada de `GitAccountsService`/`ServersService`.
 * A senha nunca volta em nenhuma resposta pública (`toPublic` a omite).
 */
@Injectable()
export class BackupDestinationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublic(d: {
    id: string;
    label: string;
    protocol: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
    createdAt: Date;
  }) {
    return {
      id: d.id,
      label: d.label,
      protocol: d.protocol,
      host: d.host,
      port: d.port,
      username: d.username,
      remotePath: d.remotePath,
      createdAt: d.createdAt,
    };
  }

  async list() {
    const rows = await this.prisma.backupDestination.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((d) => this.toPublic(d));
  }

  async create(dto: CreateBackupDestinationDto) {
    const row = await this.prisma.backupDestination.create({
      data: {
        label: dto.label.trim(),
        protocol: dto.protocol,
        host: dto.host.trim(),
        port: dto.port,
        username: dto.username.trim(),
        credentialEnc: encryptCredential(dto.password),
        remotePath: dto.remotePath?.trim() || '/',
      },
    });
    return this.toPublic(row);
  }

  async remove(id: string) {
    const row = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Destino de backup não encontrado');
    await this.prisma.backupDestination.delete({ where: { id } });
    return { ok: true };
  }

  /** Só pra uso interno (motor de backup) — nunca exposto por controller. */
  async resolveConnection(id: string): Promise<ResolvedDestination> {
    const row = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Destino de backup não encontrado');
    return {
      protocol: row.protocol,
      host: row.host,
      port: row.port,
      username: row.username,
      password: decryptCredential(row.credentialEnc),
      remotePath: row.remotePath,
    };
  }
}
```

- [ ] **Step 3: Controller**

Criar `apps/api/src/database-backup/backup-destinations.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { BackupDestinationsService } from './backup-destinations.service';
import { CreateBackupDestinationDto } from './dto/create-backup-destination.dto';

@Controller('backup-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupDestinationsController {
  constructor(private readonly destinations: BackupDestinationsService) {}

  @Get()
  list() {
    return this.destinations.list();
  }

  @Post()
  @MinRole('operator')
  create(@Body() dto: CreateBackupDestinationDto) {
    return this.destinations.create(dto);
  }

  @Delete(':id')
  @MinRole('operator')
  remove(@Param('id') id: string) {
    return this.destinations.remove(id);
  }
}
```

- [ ] **Step 4: Verificar que compila (o module ainda não existe — só checagem de sintaxe isolada nesta etapa, o build completo entra na Task 6)**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -i "backup-destination" || echo "sem erro nestes arquivos"
```

Expected: `sem erro nestes arquivos` (outros erros do projeto, se aparecerem por módulos ainda não ligados, são esperados até a Task 6 — o grep isola só o que interessa agora).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database-backup/dto/create-backup-destination.dto.ts apps/api/src/database-backup/backup-destinations.service.ts apps/api/src/database-backup/backup-destinations.controller.ts
git commit -m "CRUD de destinos de backup (FTP/SFTP)"
```

---

## Task 4: `basic-ftp` + upload/download util

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/database-backup/backup-transfer.util.ts`

**Interfaces:**
- Consumes: `SshService.uploadFile`/`downloadFile` (já existem, `apps/api/src/ssh/ssh.service.ts`), `SshConnectOptions`.
- Produces: `uploadToDestination(destination: ResolvedDestination, localPath: string): Promise<void>` — lança erro se falhar, não retorna booleano (quem chama decide o que fazer com a exceção).

- [ ] **Step 1: Adicionar a dependência**

```bash
cd apps/api && npm install basic-ftp
```

Expected: `package.json` ganha `"basic-ftp": "^5.0.5"` (ou versão mais recente da 5.x resolvida) em `dependencies`.

- [ ] **Step 2: Implementar o upload**

Criar `apps/api/src/database-backup/backup-transfer.util.ts`:

```ts
import { Client as FtpClient } from 'basic-ftp';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import type { ResolvedDestination } from './backup-destinations.service';

/**
 * Envia um arquivo local (já baixado do servidor do banco pro disco da API —
 * ver DatabaseBackupService.run) pro destino configurado. SFTP reaproveita o
 * `SshService` que já é o motor de toda conexão SSH do Velix (zero
 * dependência nova); FTP precisa de um client próprio, `basic-ftp`, porque é
 * um protocolo diferente que o `ssh2` não fala.
 */
export async function uploadToDestination(
  ssh: SshService,
  destination: ResolvedDestination,
  localPath: string,
  fileName: string,
): Promise<void> {
  const remotePath = `${destination.remotePath.replace(/\/+$/, '')}/${fileName}`;

  if (destination.protocol === 'sftp') {
    const options: SshConnectOptions = {
      host: destination.host,
      port: destination.port,
      username: destination.username,
      password: destination.password,
    };
    const result = await ssh.uploadFile(options, localPath, remotePath, 300_000);
    if (!result.ok) throw new Error(result.message || 'Falha ao enviar via SFTP');
    return;
  }

  const client = new FtpClient();
  try {
    await client.access({
      host: destination.host,
      port: destination.port,
      user: destination.username,
      password: destination.password,
      secure: false,
    });
    if (destination.remotePath && destination.remotePath !== '/') {
      await client.ensureDir(destination.remotePath);
    }
    await client.uploadFrom(localPath, fileName);
  } finally {
    client.close();
  }
}
```

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -i "backup-transfer" || echo "sem erro neste arquivo"
```

Expected: `sem erro neste arquivo`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/database-backup/backup-transfer.util.ts
git commit -m "Upload de backup pro destino: SFTP (ssh2) e FTP (basic-ftp)"
```

---

## Task 5: `DatabaseBackupService` — motor de backup

**Files:**
- Create: `apps/api/src/database-backup/database-backup.service.ts`
- Create: `apps/api/src/database-backup/dto/set-backup-config.dto.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SshService`, `ServersService.getServerWithConnectOptions(serverId)` (já existe, `apps/api/src/servers/servers.service.ts`), `decryptCredential`, `dumpCommand`/`isManagedDatabaseImage`/`backupFileName` (Task 2), `uploadToDestination` (Task 4), `BackupDestinationsService.resolveConnection` (Task 3).
- Produces: `listDatabases()`, `getConfig(projectServiceId)`, `setConfig(projectServiceId, dto)`, `listRuns(projectServiceId)`, `run(projectServiceId, trigger, onLog?): Promise<{ok:boolean; error?:string}>`, `@Cron` horário.

- [ ] **Step 1: DTO de configuração**

Criar `apps/api/src/database-backup/dto/set-backup-config.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class SetBackupConfigDto {
  /** "HH:mm", ou omitido/null pra desligar o agendamento automático. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Horário inválido (use HH:mm, ex.: 03:15)' })
  scheduledAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays?: number;

  @IsOptional()
  @IsString()
  destinationId?: string | null;
}
```

- [ ] **Step 2: Implementar o service**

Criar `apps/api/src/database-backup/database-backup.service.ts`:

```ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { decryptCredential } from '../ssh/crypto.util';
import { shellSingleQuote } from '../database/mysql.util';
import { dumpCommand, isManagedDatabaseImage, backupFileName } from './database-backup.util';
import { uploadToDestination } from './backup-transfer.util';
import { BackupDestinationsService } from './backup-destinations.service';
import { SetBackupConfigDto } from './dto/set-backup-config.dto';

type LogFn = (line: string) => void;

@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
    private readonly destinations: BackupDestinationsService,
  ) {}

  /** Todo ProjectService de banco (Postgres/MySQL/MariaDB) de todos os
   * projetos — o que alimenta a lista da aba "Bancos de Dados". */
  async listDatabases() {
    const services = await this.prisma.projectService.findMany({
      where: {
        OR: [
          { image: { contains: 'postgres', mode: 'insensitive' } },
          { image: { contains: 'mysql', mode: 'insensitive' } },
          { image: { contains: 'mariadb', mode: 'insensitive' } },
        ],
      },
      include: {
        application: { include: { server: { select: { id: true, name: true } } } },
        backupConfig: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return services
      .filter((s) => isManagedDatabaseImage(s.image))
      .map((s) => ({
        id: s.id,
        applicationId: s.applicationId,
        name: s.name,
        image: s.image,
        containerName: s.containerName,
        status: s.status,
        publishedPort: s.publishedPort,
        createdAt: s.createdAt,
        project: { id: s.application.id, name: s.application.name, slug: s.application.slug },
        server: s.application.server,
        hasSchedule: !!s.backupConfig?.scheduledAt,
      }));
  }

  async getConfig(projectServiceId: string) {
    const config = await this.prisma.databaseBackupConfig.findUnique({ where: { projectServiceId } });
    return config ?? { projectServiceId, scheduledAt: null, retentionDays: 14, destinationId: null };
  }

  async setConfig(projectServiceId: string, dto: SetBackupConfigDto) {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) throw new NotFoundException('Banco não encontrado');

    return this.prisma.databaseBackupConfig.upsert({
      where: { projectServiceId },
      create: {
        projectServiceId,
        scheduledAt: dto.scheduledAt ?? null,
        retentionDays: dto.retentionDays ?? 14,
        destinationId: dto.destinationId ?? null,
      },
      update: {
        scheduledAt: dto.scheduledAt === undefined ? undefined : dto.scheduledAt,
        retentionDays: dto.retentionDays ?? undefined,
        destinationId: dto.destinationId === undefined ? undefined : dto.destinationId,
      },
    });
  }

  listRuns(projectServiceId: string) {
    return this.prisma.databaseBackupRun.findMany({
      where: { projectServiceId },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
  }

  /**
   * Dispara o backup de um banco: dump dentro do container (via docker exec,
   * mesma técnica de `service-db-import` invertida), comprimido, baixado pro
   * disco da API e — se houver destino configurado — reenviado por SFTP/FTP.
   * O dump nunca sai direto do servidor do banco pro destino: passa pela API
   * como intermediário, igual ao backup do próprio Velix (`BackupService`).
   */
  async run(projectServiceId: string, trigger: 'scheduled' | 'manual', onLog?: LogFn): Promise<{ ok: boolean; error?: string }> {
    const service = await this.prisma.projectService.findUnique({
      where: { id: projectServiceId },
      include: { application: true, deployment: true },
    });
    if (!service) throw new NotFoundException('Banco não encontrado');
    if (!isManagedDatabaseImage(service.image)) {
      throw new BadRequestException('Backup não é suportado para este tipo de serviço');
    }
    if (!service.deployment.secretsEnc) {
      throw new BadRequestException('Não achei a senha deste banco — a implantação não gerou segredos.');
    }

    const secretsMap = JSON.parse(decryptCredential(service.deployment.secretsEnc)) as Record<string, string>;
    const secretKey = service.image.toLowerCase().includes('postgres') ? 'POSTGRES_PASSWORD' : 'ROOT_PASSWORD';
    const password = secretsMap[secretKey];
    if (!password) throw new BadRequestException(`Segredo "${secretKey}" não encontrado nesta implantação.`);

    const variablesMap = service.deployment.variablesJson ? (JSON.parse(service.deployment.variablesJson) as Record<string, string>) : {};
    const dbName = variablesMap.DATABASE_NAME || 'app';

    const dump = dumpCommand(service.image, password, dbName);
    if (!dump) throw new BadRequestException('Backup não é suportado para este tipo de serviço');

    const fileName = backupFileName(service.name);
    const config = await this.getConfig(projectServiceId);

    const run = await this.prisma.databaseBackupRun.create({
      data: { projectServiceId, trigger, status: 'RUNNING', fileName },
    });

    const { options } = await this.servers.getServerWithConnectOptions(service.application.serverId);
    const remoteTmp = `/tmp/velix-backup-${randomUUID()}.sql.gz`;
    const localTmp = join(tmpdir(), `velix-backup-${randomUUID()}.sql.gz`);

    try {
      onLog?.('Gerando o dump dentro do container...\n');
      const dumpResult = await this.ssh.runCommand(
        options,
        `sudo docker exec ${dump.execFlags} ${shellSingleQuote(service.containerName)} ${dump.command} | gzip > ${remoteTmp} && chmod 600 ${remoteTmp}`,
        600_000,
        onLog && ((chunk) => onLog(chunk)),
      );
      if (!dumpResult.ok) throw new Error(dumpResult.stderr || dumpResult.message || 'Falha ao gerar o dump');

      const statResult = await this.ssh.runCommand(options, `stat -c%s ${remoteTmp}`, 15_000);
      const sizeBytes = Number(statResult.stdout.trim()) || null;

      let uploadedRemote = false;
      if (config.destinationId) {
        onLog?.('Baixando o dump pro Velix...\n');
        const download = await this.ssh.downloadFile(options, remoteTmp, localTmp, 300_000);
        if (!download.ok) throw new Error(download.message || 'Falha ao baixar o dump do servidor');

        onLog?.('Enviando pro destino configurado...\n');
        const destination = await this.destinations.resolveConnection(config.destinationId);
        await uploadToDestination(this.ssh, destination, localTmp, fileName);
        uploadedRemote = true;
      }

      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), sizeBytes, uploadedRemote },
      });
      onLog?.('Backup concluído.\n');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no backup';
      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'ERROR', finishedAt: new Date(), error: message.slice(0, 500) },
      });
      this.logger.error(`Backup de ${service.name} (${projectServiceId}) falhou: ${message}`);
      return { ok: false, error: message };
    } finally {
      await this.ssh.runCommand(options, `sudo rm -f ${remoteTmp}`, 15_000).catch(() => undefined);
      await unlink(localTmp).catch(() => undefined);
    }
  }

  /** Varre a cada hora, na hora cheia — cobre qualquer "HH:mm" configurado
   * cujo HH bata com a hora atual (a granularidade de minuto exata não é
   * garantida, mas "todo dia por volta desse horário" já atende o pedido;
   * refinar pra minuto exato é trivial depois se fizer falta). */
  @Cron('0 * * * *')
  async scheduledSweep() {
    const currentHour = new Date().getHours().toString().padStart(2, '0');
    const configs = await this.prisma.databaseBackupConfig.findMany({
      where: { scheduledAt: { startsWith: `${currentHour}:` } },
    });
    for (const config of configs) {
      await this.run(config.projectServiceId, 'scheduled').catch((err) =>
        this.logger.error(`Backup agendado de ${config.projectServiceId} falhou: ${err instanceof Error ? err.message : err}`),
      );
    }
  }
}
```

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -i "database-backup" || echo "sem erro nestes arquivos"
```

Expected: `sem erro nestes arquivos` (o módulo ainda não está registrado no `AppModule` — normal até a Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database-backup/database-backup.service.ts apps/api/src/database-backup/dto/set-backup-config.dto.ts
git commit -m "Motor de backup de banco: dump, upload opcional, agendamento por hora"
```

---

## Task 6: Controller, módulo, canal /ops e registro no AppModule

**Files:**
- Create: `apps/api/src/database-backup/database-backup.controller.ts`
- Create: `apps/api/src/database-backup/database-backup.module.ts`
- Modify: `apps/api/src/ops/ops-server.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–5.
- Produces: rotas REST `GET /databases`, `GET /databases/:id/backup-config`, `PATCH /databases/:id/backup-config`, `GET /databases/:id/backup-runs`; op `/ops` `database-backup-run`.

- [ ] **Step 1: Controller**

Criar `apps/api/src/database-backup/database-backup.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { DatabaseBackupService } from './database-backup.service';
import { SetBackupConfigDto } from './dto/set-backup-config.dto';

/** Disparo de backup manual é via canal /ops (op "database-backup-run"),
 * não aqui — um dump pode demorar em banco grande, mesmo motivo de
 * "service-db-import" já ser streamado em vez de uma chamada REST síncrona. */
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseBackupController {
  constructor(private readonly databaseBackup: DatabaseBackupService) {}

  @Get()
  list() {
    return this.databaseBackup.listDatabases();
  }

  @Get(':id/backup-config')
  getConfig(@Param('id') id: string) {
    return this.databaseBackup.getConfig(id);
  }

  @Patch(':id/backup-config')
  @MinRole('operator')
  setConfig(@Param('id') id: string, @Body() dto: SetBackupConfigDto) {
    return this.databaseBackup.setConfig(id, dto);
  }

  @Get(':id/backup-runs')
  listRuns(@Param('id') id: string) {
    return this.databaseBackup.listRuns(id);
  }
}
```

- [ ] **Step 2: Módulo**

Criar `apps/api/src/database-backup/database-backup.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { DatabaseBackupController } from './database-backup.controller';
import { DatabaseBackupService } from './database-backup.service';
import { BackupDestinationsController } from './backup-destinations.controller';
import { BackupDestinationsService } from './backup-destinations.service';

@Module({
  // Não existe um SshModule separado — SshService é provido e exportado
  // pelo próprio ServersModule (ver servers.module.ts), mesmo jeito que
  // ApplicationsModule/GitAccountsModule já importam pra usar SSH.
  imports: [ServersModule],
  controllers: [DatabaseBackupController, BackupDestinationsController],
  providers: [DatabaseBackupService, BackupDestinationsService],
  exports: [DatabaseBackupService],
})
export class DatabaseBackupModule {}
```

- [ ] **Step 3: Registrar no `AppModule`**

Em `apps/api/src/app.module.ts`, adicionar o import e o item no array `imports`:

```ts
import { DatabaseBackupModule } from './database-backup/database-backup.module';
```

E dentro do array `imports: [...]`, logo após `ApplicationsModule,`:

```ts
    ApplicationsModule,
    DatabaseBackupModule,
```

- [ ] **Step 4: Novo op no canal `/ops`**

Em `apps/api/src/ops/ops-server.ts`:

Adicionar o import no topo:

```ts
import { DatabaseBackupService } from '../database-backup/database-backup.service';
```

Adicionar ao union `StartMessage` (logo após a entrada `service-db-import`):

```ts
  | { type: 'start'; op: 'database-backup-run'; params: { projectServiceId: string } }
```

Achar a assinatura de `handleConnection` (e de qualquer outra função que receba `deps`) e adicionar `databaseBackup: DatabaseBackupService` ao tipo de `deps` em cada uma — são as mesmas funções que hoje recebem `applications`/`gitDeploy`, então onde `applications: ApplicationsService` aparece no tipo, adicionar `databaseBackup: DatabaseBackupService` logo depois.

No bloco de despacho (onde estão os `else if (msg.op === ...)`), adicionar, logo após o bloco de `service-db-import`:

```ts
      } else if (msg.op === 'database-backup-run') {
        result = await deps.databaseBackup.run(msg.params.projectServiceId, 'manual', onLog);
```

- [ ] **Step 5: Passar a dependência em `main.ts`**

Em `apps/api/src/main.ts`, adicionar o import:

```ts
import { DatabaseBackupService } from './database-backup/database-backup.service';
```

E no objeto passado pra `attachOpsServer`, adicionar `databaseBackup: app.get(DatabaseBackupService),` junto dos outros (`applications: app.get(ApplicationsService),` etc.).

- [ ] **Step 6: Build completo da API**

```bash
cd apps/api
npx tsc --noEmit
npx nest build
npx ts-node src/app.module.spec.ts
```

Expected: as três saídas sem erro, a última terminando em `✓ app.module self-check OK — todos os módulos resolvem suas dependências`.

- [ ] **Step 7: Rodar de novo todos os self-checks já existentes (regressão)**

```bash
for f in $(find src -name "*.util.spec.ts" -o -name "app.module.spec.ts"); do
  echo "=== $f ===";
  npx ts-node "$f" 2>&1 | tail -5;
done
```

Expected: todos terminam com a linha "... self-check OK", nenhum stack trace.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/database-backup/database-backup.controller.ts apps/api/src/database-backup/database-backup.module.ts apps/api/src/ops/ops-server.ts apps/api/src/main.ts apps/api/src/app.module.ts
git commit -m "Liga o módulo database-backup: rotas REST, op /ops, AppModule"
```

---

## Task 7: Tipos do frontend + ícone

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/components/InstallLogModal.tsx`

**Interfaces:**
- Produces: tipos `DatabaseListItem`, `BackupDestinationSummary`, `DatabaseBackupConfig`, `DatabaseBackupRun`; componente `IconDatabase`; `Op` de `InstallLogModal` ganha `'database-backup-run'`.

- [ ] **Step 1: Tipos**

Em `apps/web/lib/types.ts`, adicionar ao final do arquivo:

```ts
export interface DatabaseListItem {
  id: string;
  applicationId: string;
  name: string;
  image: string;
  containerName: string;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  publishedPort: number | null;
  createdAt: string;
  project: { id: string; name: string; slug: string };
  server: { id: string; name: string };
  hasSchedule: boolean;
}

export interface BackupDestinationSummary {
  id: string;
  label: string;
  protocol: 'ftp' | 'sftp';
  host: string;
  port: number;
  username: string;
  remotePath: string;
  createdAt: string;
}

export interface DatabaseBackupConfig {
  projectServiceId: string;
  scheduledAt: string | null;
  retentionDays: number;
  destinationId: string | null;
}

export interface DatabaseBackupRun {
  id: string;
  projectServiceId: string;
  trigger: 'scheduled' | 'manual';
  status: 'RUNNING' | 'SUCCESS' | 'ERROR';
  fileName: string | null;
  sizeBytes: number | null;
  uploadedRemote: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: Ícone**

Em `apps/web/components/icons.tsx`, adicionar (perto de `IconHardDrive`, mesmo estilo dos demais):

```tsx
export function IconDatabase({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}
```

- [ ] **Step 3: `InstallLogModal` — novo op**

Em `apps/web/components/InstallLogModal.tsx`, no tipo `Op`, adicionar logo após `'service-db-import'`:

```ts
  | 'database-backup-run'
```

- [ ] **Step 4: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro (nada ainda consome os tipos novos, então não há uso incorreto pra pegar aqui — essa checagem é só sintaxe).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/types.ts apps/web/components/icons.tsx apps/web/components/InstallLogModal.tsx
git commit -m "Tipos e ícone novos pra Bancos de Dados"
```

---

## Task 8: Item novo na barra lateral

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `IconDatabase` (Task 7).

- [ ] **Step 1: Adicionar o item ao grupo "Infraestrutura"**

Em `apps/web/components/Sidebar.tsx`, adicionar `IconDatabase` ao import de ícones e inserir o item logo após "Projetos" no array `GROUPS`:

```ts
import {
  IconDashboard,
  IconServer,
  IconSettings,
  IconLogout,
  IconStore,
  IconLayoutGrid,
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
} from './icons';
```

```ts
  {
    title: 'Infraestrutura',
    items: [
      { href: '/servers', label: 'Servidores', description: 'Cadastro e monitoramento', icon: IconServer },
      { href: '/library', label: 'Loja', description: 'Catálogo de aplicativos', icon: IconStore },
      { href: '/projects', label: 'Projetos', description: 'O que está implantado', icon: IconLayoutGrid },
      { href: '/databases', label: 'Bancos de Dados', description: 'Backup e conexão', icon: IconDatabase },
    ],
  },
```

- [ ] **Step 2: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/Sidebar.tsx
git commit -m "Item 'Bancos de Dados' na barra lateral"
```

---

## Task 9: Assistente de criação (`DatabaseCreateWizard`)

**Files:**
- Create: `apps/web/components/DatabaseCreateWizard.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `InstallLogModal` (`op="service-deploy"`), `ServerSummary` (já existe em `lib/types.ts`).
- Produces: `DatabaseCreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void })`.

- [ ] **Step 1: Implementar**

Criar `apps/web/components/DatabaseCreateWizard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ServerSummary } from '@/lib/types';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { InstallLogModal } from './InstallLogModal';

const ENGINES = [
  { slug: 'postgresql', label: 'PostgreSQL', version: '16.4' },
  { slug: 'mysql', label: 'MySQL', version: '8.4' },
  { slug: 'mariadb', label: 'MariaDB', version: '11.4' },
] as const;

/**
 * Assistente curto pra criar um banco — sem o usuário nunca ver a palavra
 * "projeto": escolhe motor, nome, servidor, e o Velix cria o projeto por
 * baixo dos panos sozinho (mesma chamada que o catálogo já faz hoje pra
 * qualquer app: POST /applications + op "service-deploy").
 */
export function DatabaseCreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [engine, setEngine] = useState<(typeof ENGINES)[number]['slug']>('postgresql');
  const [name, setName] = useState('');
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [serverId, setServerId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ServerSummary[]>('/servers').then((list) => {
      setServers(list);
      const recommended = list.find((s) => s.dockerInstalled);
      if (recommended) setServerId(recommended.id);
    });
  }, []);

  const selectedServer = servers?.find((s) => s.id === serverId) ?? null;
  const valid = name.trim().length >= 2 && !!selectedServer?.dockerInstalled;

  async function create() {
    if (!valid) return;
    setCreating(true);
    setError(null);
    try {
      const app = await apiFetch<{ id: string }>('/applications', {
        method: 'POST',
        body: JSON.stringify({ serverId, name: name.trim() }),
      });
      setApplicationId(app.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar o banco');
      setCreating(false);
    }
  }

  if (applicationId) {
    return (
      <InstallLogModal
        serverId={serverId}
        op="service-deploy"
        params={{ applicationId, manifestSlug: engine }}
        title={`Criando banco ${name}`}
        onClose={onClose}
        onDone={(ok) => {
          if (ok) onCreated();
        }}
      />
    );
  }

  return (
    <Modal title="Criar banco" onClose={creating ? undefined : onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Motor</span>
          <div className="grid grid-cols-3 gap-2">
            {ENGINES.map((e) => (
              <button
                key={e.slug}
                type="button"
                onClick={() => setEngine(e.slug)}
                className={`rounded-lg border px-3 py-2.5 text-sm transition ${
                  engine === e.slug
                    ? 'border-indigo-500 bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                {e.label}
                <span className="mt-0.5 block text-[11px] font-normal text-slate-400">v{e.version}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: banco-do-app" className="input" />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Servidor</span>
          <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="input">
            {!servers && <option>Carregando...</option>}
            {servers?.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.dockerInstalled}>
                {s.name}
                {!s.dockerInstalled ? ' (sem Docker)' : ''}
              </option>
            ))}
          </select>
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Cancelar
          </button>
          <button onClick={create} disabled={!valid || creating} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {creating ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro. (`ServerSummary` já expõe `dockerInstalled` — confirmado em `lib/types.ts`, usado do mesmo jeito em `DeployWizard.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/DatabaseCreateWizard.tsx
git commit -m "Assistente curto de criação de banco"
```

---

## Task 10: Página de listagem (`/databases`)

**Files:**
- Create: `apps/web/app/(dashboard)/databases/page.tsx`
- Delete: conteúdo antigo de `apps/web/app/(dashboard)/databases/[id]/page.tsx` (substituído na Task 11 — nesta task só a listagem)

**Interfaces:**
- Consumes: `GET /databases` (Task 6), `DatabaseListItem` (Task 7), `DatabaseCreateWizard` (Task 9).

- [ ] **Step 1: Implementar**

Criar `apps/web/app/(dashboard)/databases/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { DatabaseListItem } from '@/lib/types';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { DatabaseCreateWizard } from '@/components/DatabaseCreateWizard';
import { IconDatabase, IconPlus, IconClock } from '@/components/icons';

const STATUS_TONE: Record<string, StatusTone> = {
  RUNNING: 'success',
  DEPLOYING: 'info',
  STOPPED: 'neutral',
  ERROR: 'danger',
};

function engineLabel(image: string) {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'PostgreSQL';
  if (img.includes('mariadb')) return 'MariaDB';
  if (img.includes('mysql')) return 'MySQL';
  return image;
}

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<DatabaseListItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiFetch<DatabaseListItem[]>('/databases').then(setDatabases);
  }

  useEffect(load, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Bancos de Dados</h1>
          <p className="text-xs text-slate-400">Postgres, MySQL e MariaDB gerenciados pelo Velix — conexão, backup e mais</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Criar banco
        </button>
      </div>

      {!databases && <Skeleton className="h-40" />}

      {databases && databases.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <IconDatabase className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-sm text-slate-400">Nenhum banco de dados ainda.</p>
        </div>
      )}

      {databases && databases.length > 0 && (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {databases.map((db) => (
            <Link
              key={db.id}
              href={`/databases/${db.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                  <IconDatabase className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{db.project.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {engineLabel(db.image)} · {db.server.name}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {db.hasSchedule && (
                  <span title="Backup agendado">
                    <IconClock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  </span>
                )}
                <StatusBadge tone={STATUS_TONE[db.status] ?? 'neutral'}>{db.status}</StatusBadge>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <DatabaseCreateWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/databases/page.tsx"
git commit -m "Página de listagem de Bancos de Dados"
```

---

## Task 11: Página dedicada por banco (substitui a antiga órfã)

**Files:**
- Modify (substituir todo o conteúdo): `apps/web/app/(dashboard)/databases/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /applications/:id` (já existe), `DatabaseBackupConfig`/`DatabaseBackupRun`/`BackupDestinationSummary` (Task 7), `GET/PATCH /databases/:id/backup-config`, `GET /databases/:id/backup-runs`, `GET /backup-destinations`, op `database-backup-run`.

- [ ] **Step 1: Ler o arquivo atual pra confirmar que é seguro substituir por inteiro**

```bash
cat "apps/web/app/(dashboard)/databases/[id]/page.tsx"
```

Confirmar que nada externo referencia componentes exportados por esse arquivo (já verificado na fase de brainstorm: `grep -rln "/databases/" app components lib` não retornou nenhuma referência em todo o frontend — o arquivo é órfão). Se o grep abaixo devolver algo além do próprio arquivo, parar e reavaliar antes de continuar:

```bash
grep -rln "from '@/app/(dashboard)/databases" apps/web --include="*.tsx" --include="*.ts" 2>/dev/null
```

Expected: nenhuma saída.

- [ ] **Step 2: Substituir o conteúdo inteiro**

Escrever `apps/web/app/(dashboard)/databases/[id]/page.tsx` (sobrescrevendo o arquivo todo):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  ProjectDetail,
  ProjectService,
  DatabaseBackupConfig,
  DatabaseBackupRun,
  BackupDestinationSummary,
} from '@/lib/types';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { Alert } from '@/components/Alert';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { InstallLogModal } from '@/components/InstallLogModal';
import { IconDatabase, IconGlobe, IconFileText, IconClock, IconCheck, IconEye, IconEyeOff, IconCopy } from '@/components/icons';

const STATUS_TONE: Record<string, StatusTone> = { RUNNING: 'success', DEPLOYING: 'info', STOPPED: 'neutral', ERROR: 'danger' };
const RUN_TONE: Record<string, StatusTone> = { SUCCESS: 'success', RUNNING: 'info', ERROR: 'danger' };

function engineLabel(image: string) {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'PostgreSQL';
  if (img.includes('mariadb')) return 'MariaDB';
  if (img.includes('mysql')) return 'MySQL';
  return image;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DatabaseDetailPage() {
  const params = useParams<{ id: string }>();
  const databaseId = params.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [service, setService] = useState<ProjectService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deployingAdminer, setDeployingAdminer] = useState(false);

  function load() {
    // O id da rota é o ProjectService.id — precisamos achar em qual
    // Application ele vive antes de poder buscar o projeto inteiro.
    apiFetch<{ applicationId: string }[]>('/databases')
      .then(async (list) => {
        // lista completa já tem o bastante — evita um segundo endpoint só
        // pra resolver applicationId a partir de um ProjectService.id.
      })
      .catch(() => undefined);
  }

  // A lista /databases já devolve applicationId — buscamos ela uma vez pra
  // descobrir a qual projeto este banco pertence, depois carregamos o
  // projeto completo (mesmos dados que a tela de serviço genérica usa).
  useEffect(() => {
    apiFetch<{ id: string; applicationId: string }[]>('/databases')
      .then((list) => {
        const entry = list.find((d) => d.id === databaseId);
        if (!entry) {
          setError('Banco não encontrado.');
          return;
        }
        return apiFetch<ProjectDetail>(`/applications/${entry.applicationId}`).then((app) => {
          setProject(app);
          const svc = app.services.find((s) => s.id === databaseId);
          if (!svc) {
            setError('Banco não encontrado neste projeto.');
            return;
          }
          setService(svc);
          const deployment = app.deployments.find((d) => d.id === svc.deploymentId);
          if (deployment) {
            apiFetch<Record<string, string>>(`/applications/${app.id}/deployments/${deployment.id}/credentials`)
              .then(setCredentials)
              .catch(() => setCredentials({}));
          }
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!project || !service) return <Skeleton className="h-64" />;

  const credEntries = credentials ? Object.entries(credentials) : [];

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
        <p className="section-label">Conexão</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Container</p>
            <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{service.containerName}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Porta publicada</p>
            <p className="text-slate-700 dark:text-slate-200">{service.publishedPort ?? '— (só interna)'}</p>
          </div>
        </div>

        {credEntries.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">Segredos gerados</p>
              <button onClick={() => setRevealed((v) => !v)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {revealed ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                {revealed ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <div className="space-y-1.5">
              {credEntries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500">{key}</p>
                    <p className="truncate font-mono text-xs">{revealed ? value : '••••••••••••'}</p>
                  </div>
                  <button onClick={() => copy(key, value)} className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                    {copiedKey === key ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => setDeployingAdminer(true)} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
            <IconGlobe className="h-4 w-4" aria-hidden />
            Abrir interface web
          </button>
        </div>
      </div>

      <BackupSection databaseId={databaseId} />

      {deployingAdminer && (
        <InstallLogModal
          serverId={project.server.id}
          op="service-deploy"
          params={{ applicationId: project.id, manifestSlug: 'adminer', variables: { DEFAULT_SERVER: service.containerName } }}
          title="Implantando Adminer"
          onClose={() => setDeployingAdminer(false)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}

function BackupSection({ databaseId }: { databaseId: string }) {
  const [config, setConfig] = useState<DatabaseBackupConfig | null>(null);
  const [runs, setRuns] = useState<DatabaseBackupRun[] | null>(null);
  const [destinations, setDestinations] = useState<BackupDestinationSummary[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [retentionDays, setRetentionDays] = useState(14);
  const [destinationId, setDestinationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<DatabaseBackupConfig>(`/databases/${databaseId}/backup-config`).then((c) => {
      setConfig(c);
      setScheduledAt(c.scheduledAt ?? '');
      setRetentionDays(c.retentionDays);
      setDestinationId(c.destinationId ?? '');
    });
    apiFetch<DatabaseBackupRun[]>(`/databases/${databaseId}/backup-runs`).then(setRuns);
    apiFetch<BackupDestinationSummary[]>('/backup-destinations').then(setDestinations);
  }

  useEffect(load, [databaseId]);

  async function saveSchedule() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/databases/${databaseId}/backup-config`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledAt: scheduledAt.trim() || null,
          retentionDays,
          destinationId: destinationId || null,
        }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar agendamento');
    } finally {
      setSaving(false);
    }
  }

  if (!config || !runs) return <Skeleton className="h-40" />;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="section-label">Backups</p>
        <button onClick={() => setRunning(true)} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconFileText className="h-4 w-4" aria-hidden />
          Fazer backup agora
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3 dark:border-slate-700">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Horário diário (opcional)</span>
          <input type="time" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input h-9" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Retenção (dias)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="input h-9"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Destino remoto (opcional)</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className="input h-9">
            <option value="">Só neste servidor</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.protocol.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      </div>
      {destinations.length === 0 && (
        <p className="text-xs text-slate-400">
          Nenhum destino de backup configurado ainda — adicione um em Configurações → Backup.
        </p>
      )}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex justify-end">
        <button onClick={saveSchedule} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar agendamento'}
        </button>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
          <IconClock className="h-3.5 w-3.5" aria-hidden />
          Histórico
        </p>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum backup ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-slate-700 dark:text-slate-200">{new Date(r.startedAt).toLocaleString('pt-BR')}</p>
                  <p className="truncate text-slate-400">
                    {r.trigger === 'manual' ? 'Manual' : 'Agendado'} · {formatBytes(r.sizeBytes)}
                    {r.uploadedRemote ? ' · enviado ao destino' : ''}
                  </p>
                </div>
                <StatusBadge tone={RUN_TONE[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
              </div>
            ))}
          </div>
        )}
      </div>

      {running && (
        <InstallLogModal
          serverId=""
          op="database-backup-run"
          params={{ projectServiceId: databaseId }}
          title="Fazendo backup"
          onClose={() => setRunning(false)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Corrigir o `serverId` do `InstallLogModal` de backup manual**

O `InstallLogModal` de `database-backup-run` acima usa `serverId=""`, que está errado — o canal `/ops` precisa do `serverId` de verdade pra abrir a conexão e checar o papel do usuário (ver `ops-server.ts`, Task 6). Ajustar `BackupSection` pra receber o server do banco como prop, em vez de tentar adivinhar:

Trocar a assinatura de `BackupSection`:

```tsx
function BackupSection({ databaseId, serverId }: { databaseId: string; serverId: string }) {
```

E no `DatabaseDetailPage`, trocar a chamada:

```tsx
      <BackupSection databaseId={databaseId} serverId={project.server.id} />
```

E dentro de `BackupSection`, no `InstallLogModal`, trocar `serverId=""` por `serverId={serverId}`.

- [ ] **Step 4: Remover a função `load` morta no topo de `DatabaseDetailPage`**

A função `load()` declarada logo antes do primeiro `useEffect` não é usada em lugar nenhum (o carregamento real está no `useEffect` abaixo dela) — apagar esse bloco morto:

```tsx
  function load() {
    // O id da rota é o ProjectService.id — precisamos achar em qual
    // Application ele vive antes de poder buscar o projeto inteiro.
    apiFetch<{ applicationId: string }[]>('/databases')
      .then(async (list) => {
        // lista completa já tem o bastante — evita um segundo endpoint só
        // pra resolver applicationId a partir de um ProjectService.id.
      })
      .catch(() => undefined);
  }
```

(apagar o bloco inteiro acima, incluindo o comentário)

- [ ] **Step 5: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro. (`Breadcrumb({ items }: { items: BreadcrumbItem[] })`, cada item `{label, href?}`, já confirmado batendo com a chamada acima.)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/databases/[id]/page.tsx"
git commit -m "Página dedicada por banco: conexão, Adminer, backups"
```

---

## Task 12: Card de Destinos de Backup em Configurações

**Files:**
- Create: `apps/web/components/BackupDestinationsCard.tsx`
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `BackupDestinationSummary` (Task 7), `GET/POST/DELETE /backup-destinations` (Task 6).

- [ ] **Step 1: Implementar o card**

Criar `apps/web/components/BackupDestinationsCard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { BackupDestinationSummary } from '@/lib/types';
import { Alert } from './Alert';
import { ConfirmModal } from './Modal';
import { IconPlus, IconTrash } from './icons';

/**
 * Destinos FTP/SFTP salvos pra onde um backup de banco pode ser enviado —
 * mesmo padrão visual/de uso de GitAccountsCard: listar, adicionar, remover.
 * Sem edição — pra trocar, remove e cadastra de novo (senha nunca volta em
 * claro, então não daria pra pré-preencher um formulário de edição mesmo).
 */
export function BackupDestinationsCard() {
  const [destinations, setDestinations] = useState<BackupDestinationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<BackupDestinationSummary | null>(null);

  const [label, setLabel] = useState('');
  const [protocol, setProtocol] = useState<'sftp' | 'ftp'>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remotePath, setRemotePath] = useState('/');

  function load() {
    apiFetch<BackupDestinationSummary[]>('/backup-destinations')
      .then(setDestinations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, []);

  function resetForm() {
    setLabel('');
    setHost('');
    setUsername('');
    setPassword('');
    setRemotePath('/');
    setPort(protocol === 'sftp' ? 22 : 21);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/backup-destinations', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), protocol, host: host.trim(), port, username: username.trim(), password, remotePath: remotePath.trim() || '/' }),
      });
      setAdding(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o destino');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setSaving(true);
    try {
      await apiFetch(`/backup-destinations/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-title">Destinos de backup</p>
          <p className="text-xs text-slate-400">Servidores FTP/SFTP pra onde um backup de banco pode ser enviado</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
            <IconPlus className="h-4 w-4" aria-hidden />
            Adicionar
          </button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {destinations === null && <p className="text-sm text-slate-400">Carregando...</p>}
      {destinations?.length === 0 && !adding && <p className="text-sm text-slate-400">Nenhum destino configurado ainda.</p>}

      {destinations && destinations.length > 0 && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {destinations.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{d.label}</p>
                <p className="truncate text-xs text-slate-400">
                  {d.protocol.toUpperCase()} · {d.username}@{d.host}:{d.port}{d.remotePath}
                </p>
              </div>
              <button
                onClick={() => setRemoving(d)}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                aria-label="Remover destino"
              >
                <IconTrash className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Rótulo</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex.: Servidor de backup" className="input" required />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Protocolo</span>
            <select
              value={protocol}
              onChange={(e) => {
                const next = e.target.value as 'sftp' | 'ftp';
                setProtocol(next);
                setPort(next === 'sftp' ? 22 : 21);
              }}
              className="input"
            >
              <option value="sftp">SFTP</option>
              <option value="ftp">FTP</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Host</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="backup.seudominio.com" className="input" required />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Porta</span>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className="input" required />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Usuário</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" required />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Senha</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" required />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Diretório remoto</span>
            <input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/" className="input" />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="btn-secondary px-3.5 py-2 text-sm"
            >
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {removing && (
        <ConfirmModal
          title="Remover destino"
          message={`Remover "${removing.label}"? Bancos configurados pra usar esse destino passam a fazer backup só localmente.`}
          confirmLabel="Remover"
          danger
          loading={saving}
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ligar na tela de Configurações**

Em `apps/web/app/(dashboard)/settings/page.tsx`, adicionar o import:

```ts
import { BackupDestinationsCard } from '@/components/BackupDestinationsCard';
```

E, logo após `{tab === 'backup' && <BackupCard />}`, adicionar:

```tsx
      {tab === 'backup' && <BackupDestinationsCard />}
```

(as duas linhas ficam juntas, ambas condicionadas a `tab === 'backup'` — os dois cards aparecem um embaixo do outro na mesma aba)

- [ ] **Step 3: Verificar**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/BackupDestinationsCard.tsx "apps/web/app/(dashboard)/settings/page.tsx"
git commit -m "Card de Destinos de Backup em Configurações"
```

---

## Task 13: Verificação final, versão, release

**Files:** nenhum novo — só validação e o ritual de release já usado em toda a sessão.

- [ ] **Step 1: Build completo da API**

```bash
cd apps/api
npx tsc --noEmit
npx nest build
```

Expected: ambos sem erro.

- [ ] **Step 2: Todos os self-checks da API**

```bash
for f in $(find src -name "*.util.spec.ts" -o -name "app.module.spec.ts"); do
  echo "=== $f ==="
  npx ts-node "$f" 2>&1 | tail -5
done
```

Expected: toda linha final é "... self-check OK", nenhum stack trace — inclui `database-backup.util self-check OK` (Task 2) e `app.module self-check OK` confirmando que `DatabaseBackupModule` resolve todas as dependências (Task 6).

- [ ] **Step 3: Build completo do frontend**

```bash
cd apps/web
npx tsc --noEmit
npx next build
```

Expected: ambos sem erro; a rota `/databases` e `/databases/[id]` aparecem na listagem de rotas do build (`ƒ /databases` estático ou dinâmico conforme o Next decidir, `ƒ /databases/[id]` dinâmica).

- [ ] **Step 4: Checar o `git status` antes de commitar a versão — nada fora do esperado**

```bash
cd /caminho/do/repo && git status --short
```

Expected: só arquivos das Tasks 1–12 (já commitados task a task) mais o `VERSION` que será alterado agora — se aparecer algo inesperado, investigar antes de seguir.

- [ ] **Step 5: Bump de versão**

Ler `apps/api/VERSION`, incrementar o MINOR (é uma feature nova, não um bugfix — mesmo critério usado em toda a sessão: v1.14.0 pra SQL import+Adminer+porta, v1.15.0 pro editor de ambiente+domínios). Se a versão atual for, por exemplo, `1.15.3`, o novo `apps/api/VERSION` fica `1.16.0`.

- [ ] **Step 6: Commit da versão**

```bash
git add apps/api/VERSION
git commit -m "$(cat <<'EOF'
Aba Bancos de Dados + backup (FTP/SFTP)

<resumo do que foi feito, seguindo o padrão de commits desta sessão:
raiz do problema/pedido, o que foi construído, o que foi testado e o que
não foi (sem Docker/Postgres/servidor FTP real neste ambiente)>
EOF
)"
```

- [ ] **Step 7: Push**

```bash
git push origin main
```

- [ ] **Step 8: Release**

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(cat <<'EOF'
<notas de release em português, no mesmo tom usado em toda a sessão:
o que o usuário ganha, qualquer observação de escopo/limitação>
EOF
)"
```

---

## Notas pra quem for executar

- **Sem Docker/Postgres/servidor FTP real neste ambiente de desenvolvimento** — nada do fluxo de dump/upload de verdade é testável fim a fim aqui. Toda verificação é `tsc`/`nest build`/self-checks de função pura/`next build`. Recomendar ao usuário testar contra um banco e um destino FTP/SFTP reais antes de confiar em produção — mesma ressalva de todo recurso que mexe em SSH/Docker construído nesta sessão.
- Task 11 é a maior e mais arriscada de errar em detalhes de integração (busca o `applicationId` a partir da lista, depois o projeto inteiro, depois o serviço) — se algo não bater (nome de prop de `Breadcrumb`, formato de resposta de algum endpoint), parar e conferir contra o código real em vez de adivinhar; os Steps de cada task já apontam onde checar.
- O sistema órfão antigo (`apps/api/src/database/`, model `DatabaseInstance`) **não é tocado** por este plano — fica como limpeza separada, fora de escopo (documentado na spec, seção 7).
