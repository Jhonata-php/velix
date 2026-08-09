# Aba "Bancos de Dados" + Backup — Design

**Status:** aprovado pelo usuário na conversa, aguardando revisão da spec escrita antes do plano de implementação.
**Contexto:** hoje um banco (Postgres/MySQL/MariaDB) só existe como um serviço dentro de um Projeto genérico — mesma tela, mesmas abas (Fonte, Ambiente, Domínios, Terminal) de qualquer app. O usuário pediu uma aba própria "Bancos de Dados", separada de "Projetos", que não misture banco com a visão de containers crus de um projeto qualquer, e que permita criar backups — inclusive mandando pra outro servidor via FTP/SFTP.

## 1. Objetivo e não-objetivos

**Objetivo:** uma aba dedicada na barra lateral que lista todo banco de dados gerenciado pelo Velix (não importa em qual Projeto ele vive), com um fluxo de criação curto e uma página própria por banco — conexão, Adminer, importar .sql (recursos que já existem), mais backup manual e agendado, com opção de mandar o arquivo pra um servidor remoto via FTP ou SFTP.

**Fora do escopo desta fase** (decidido explicitamente, não esquecimento):
- Armazenamento em nuvem tipo S3/Backblaze/Wasabi — só FTP e SFTP por enquanto.
- Restauração automática de um backup pela UI — o backup fica disponível pra baixar/importar manualmente (reaproveitando o "Importar .sql" que já existe) até haver um caso de uso real pra automatizar.
- Múltiplos destinos por banco — um destino de backup por banco nesta fase.
- Reviver o sistema antigo `DatabaseInstance`/réplica (órfão, sem link em nenhuma tela hoje) — decidido explicitamente na conversa: a aba nova é uma visão sobre o modelo de Projetos já existente, não um sistema paralelo.

## 2. Arquitetura

### 2.1 Onde o dado mora
Criar um banco continua sendo, por baixo dos panos, exatamente o que já é hoje: um `Application` (projeto) com um `ProjectDeployment` de um manifesto do catálogo (`postgres`/`mysql`/`mariadb`) e um `ProjectService`. A aba "Bancos de Dados" **não introduz um tipo de entidade novo pro banco em si** — ela é uma consulta que filtra, entre todos os `ProjectService` de todos os projetos, os que "parecem banco" (mesma função `looksLikeDatabase` já usada na aba Ambiente/Visão Geral desde a v1.14.0), e uma página de detalhe que reaproveita os endpoints já existentes (`getCredentials`, `/endpoints`, `service-deploy` do Adminer, `service-db-import`, `publish-port`) atrás de uma UI diferente da tela genérica de serviço.

Isso significa: bancos criados **antes** desta feature (como o `MySQL` do print do usuário) aparecem na lista automaticamente, sem migração de dados nem recriação.

### 2.2 Criação
"Criar banco" abre um assistente curto e dedicado (componente novo, não o `DeployWizard` genérico): motor (Postgres/MySQL/MariaDB), versão, nome do banco, servidor. Ao confirmar, cria um `Application` com o mesmo nome (slugificado) e implanta o manifesto do catálogo correspondente — mesma chamada que o catálogo já faz hoje (`POST /applications` + op `service-deploy`), só que o usuário nunca vê a palavra "projeto" nem passa pelas etapas genéricas (ambiente, tags, etc.) que não fazem sentido pra "eu só quero um banco".

### 2.3 Backup — motor

**Dump:** reaproveita o padrão já estabelecido em `dbImportCommand`/`container-shell.util.ts` (mesmo módulo, funções irmãs) — `docker exec` rodando `pg_dump`/`mysqldump` dentro do container, gravando comprimido (`gzip`) num arquivo temporário no host do banco (mesmo SSH já usado por toda a plataforma, sem volume novo). Diferente do backup do próprio Velix (`BackupService`, que roda `pg_dump` fora do container porque é o container da própria API rodando contra o Postgres do Velix), aqui o dump roda **dentro** do container do banco do usuário via `docker exec`, porque o Velix não tem — e não deve ter — acesso direto de rede ao Postgres/MySQL de cada projeto.

**Upload pro destino (se configurado):**
- **SFTP:** reaproveita o `ssh2` que já é dependência do projeto (é o motor de toda conexão SSH do Velix) — `Client.sftp()` sobe o arquivo sem precisar de nenhuma biblioteca nova.
- **FTP:** dependência nova, `basic-ftp` (promise-based, zero dependências transitivas, é o padrão do ecossistema Node hoje).
- Sem destino configurado: o backup fica só no host onde o banco roda, mesma lógica de retenção por dias que o `BackupService` do Velix já usa.

**Agendamento:** um `@Cron` de hora em hora (mesmo pacote `@nestjs/schedule` já em uso) varre os `DatabaseBackupConfig` com horário batendo com a hora atual e dispara o backup — evita um cron por banco (não escala) e reaproveita o padrão já validado em produção pelo backup do próprio Velix. Também existe o botão "Fazer backup agora" pra disparo manual a qualquer momento, streamado via `/ops` (novo op `database-backup-run`, mesmo canal já usado por `service-db-import`).

### 2.4 Segurança
- Credencial do destino FTP/SFTP cifrada com o mesmo `encryptCredential`/AES-256-GCM já usado em `GitAccount.tokenEnc`/`Server.credentialEnc` — nenhuma nova forma de guardar segredo.
- Nome de banco/valores que entram em comando `docker exec` seguem a mesma lição da v1.15.2 (`dbImportCommand`): tudo protegido com `shellSingleQuote` antes de entrar num `runCommand`, sem exceção.
- Rotas de criação/gestão de destino e de configuração de backup exigem `@MinRole('operator')` (mutação), leitura exige só `JwtAuthGuard` — mesma convenção já usada em toda a API.

## 3. Modelo de dados (migração Prisma nova, só `CREATE TABLE`/`ADD COLUMN`, sem `ALTER TYPE` — lição da v1.11.0)

```prisma
model BackupDestination {
  id          String   @id @default(uuid())
  label       String
  protocol    String   // "ftp" | "sftp"
  host        String
  port        Int
  username    String
  /// Cifrado com o mesmo padrão AES-256-GCM já usado em GitAccount/Server.
  credentialEnc String
  /// Diretório remoto onde os arquivos de backup são gravados.
  remotePath  String   @default("/")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  backupConfigs DatabaseBackupConfig[]
}

model DatabaseBackupConfig {
  id             String   @id @default(uuid())
  projectServiceId String @unique
  projectService ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)

  /// Horário diário no formato "HH:mm" (fuso do servidor da API) — null = sem agendamento, só manual.
  scheduledAt    String?
  retentionDays  Int      @default(14)

  destinationId  String?
  destination    BackupDestination? @relation(fields: [destinationId], references: [id], onDelete: SetNull)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model DatabaseBackupRun {
  id             String   @id @default(uuid())
  projectServiceId String
  projectService ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)

  trigger        String   // "scheduled" | "manual"
  status         String   // "RUNNING" | "SUCCESS" | "ERROR"
  fileName       String?
  sizeBytes      Int?
  uploadedRemote Boolean  @default(false)
  error          String?
  startedAt      DateTime @default(now())
  finishedAt     DateTime?

  @@index([projectServiceId])
}
```

`ProjectService` ganha as relações inversas (`backupConfig DatabaseBackupConfig?`, `backupRuns DatabaseBackupRun[]`).

## 4. Backend — módulo novo `src/database-backup/`

Módulo novo (não reaproveita `src/database/`, que é o sistema órfão de `DatabaseInstance` — nome escolhido de propósito pra não colidir), seguindo o padrão de módulos já existentes (`*.service.ts` com a lógica, `*.controller.ts` fino, `*.util.ts` com funções puras testáveis via `ts-node`):

- `BackupDestinationsService` + `BackupDestinationsController`: CRUD de `BackupDestination` (`GET/POST /backup-destinations`, `DELETE /backup-destinations/:id`) — mesmo padrão de `GitAccountsController`.
- `DatabaseBackupService`: `run(projectServiceId, trigger)` (dump + upload opcional + grava `DatabaseBackupRun`), `getConfig`/`setConfig` (agendamento/destino/retenção), `@Cron` de hora em hora pro disparo agendado, `listRuns(projectServiceId)`.
- `database-backup.util.ts`: funções puras — `dumpCommand(image, ...)` (irmã de `dbImportCommand`, mesma ideia invertida: gera pro lado do dump em vez do import) e helpers de nome de arquivo/caminho remoto, com `*.spec.ts` no mesmo formato `ts-node` já usado em todo o backend.
- Endpoint novo `GET /databases` (lista todos os `ProjectService` de banco de todos os projetos, com o projeto/servidor pai) — o que alimenta a lista da aba nova.
- Novo op no canal `/ops`: `database-backup-run` (dump pode demorar em banco grande, mesmo motivo de `service-db-import` já ser streamado).

## 5. Frontend

- Item novo na barra lateral, "Bancos de Dados" (ícone `IconDisk` ou similar), entre "Projetos" e "Automação".
- `app/(dashboard)/databases/page.tsx` (rota nova — a antiga `/databases/[id]` do sistema órfão é removida nesta mesma entrega, já que fica substituída e mantê-la só confundiria): lista todos os bancos (`GET /databases`), botão "Criar banco".
- `DatabaseCreateWizard.tsx` (componente novo, curto): motor → versão → nome → servidor → confirma.
- `app/(dashboard)/databases/[id]/page.tsx`: página dedicada por banco — Visão Geral (conexão, Adminer, importar .sql, publicar porta, reaproveitando a lógica já escrita em `OverviewTab`/`PublishPortControl` desta sessão) + aba **Backups** nova (lista de execuções, "Fazer backup agora", formulário de agendamento + escolha de destino).
- Configurações ganha o card **"Destinos de Backup"** (FTP/SFTP), mesmo estilo visual de `GitAccountsCard`/`CloudflareCard` — listar, adicionar, remover.

## 6. Testes / verificação

Mesmo padrão desta sessão inteira: `tsc --noEmit` + `nest build` na API, self-check `*.util.spec.ts` via `ts-node` pras funções puras (principalmente `dumpCommand`, incluindo teste de injeção de shell tipo o que pegou o bug real da v1.15.2), self-check de DI (`app.module.spec.ts`), `tsc --noEmit` + `next build` no frontend. **Não é possível testar o dump/upload de verdade neste ambiente** (sem Docker/Postgres/servidor FTP real) — recomendo testar contra um banco e um destino FTP/SFTP reais antes de confiar em produção, igual todo recurso que mexe em SSH/Docker desta sessão.

## 7. Migração da UI existente

O link e a rota antigos de `/databases/[id]` (sistema órfão `DatabaseInstance`) são removidos como parte desta entrega — a nova aba assume o nome e o lugar que faziam sentido pra ele, sem deixar duas telas de "banco de dados" no ar. O backend do sistema antigo (`DatabaseService`/`DatabaseController`/model `DatabaseInstance`) fica intacto por enquanto (não é usado por nada novo, mas removê-lo é uma limpeza separada, fora do escopo desta entrega — sinalizado, não esquecido).
