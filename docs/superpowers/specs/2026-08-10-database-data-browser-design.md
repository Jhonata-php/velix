# Gerenciador de banco de dados embutido — Design

**Status:** aprovado pelo usuário na conversa ("isso mesmo isso tudo dentro ja da aba do banco de dados pode implementar bem bonito para facar algo profissional e responsivo").
**Contexto:** o único jeito de navegar dados de um banco criado pelo Velix é implantar o Adminer (v1.17.3–v1.18.2) e abrir num domínio à parte — feio, sai do Velix, e o domínio automático levou a uma sessão inteira de bugs (constraint única, status enganoso). O usuário pediu algo embutido na própria aba do banco, bonito e profissional, pra navegar tabelas e rodar SQL sem sair do Velix.

## 1. Objetivo e não-objetivos

**Objetivo:** uma aba nova "Dados" na página de detalhe do banco (`databases/[id]`) com: lista de tabelas, grade de linhas paginada/pesquisável (só leitura), editor de SQL livre (roda qualquer comando, inclusive `UPDATE`/`INSERT`/`DELETE` manual) e histórico das queries já executadas. Funciona pra PostgreSQL, MySQL e MariaDB — os três motores que o Velix já cria.

**Fora do escopo desta fase** (combinado explicitamente):
- Editar célula por célula na grade — a grade é só leitura; qualquer escrita é via SQL manual no editor.
- Funções administrativas do Adminer que ficam pra trás: gerenciar usuários/privilégios do banco, ver processos/conexões ativas, configurar variáveis do servidor. Quem precisar disso usa um cliente externo (DBeaver/TablePlus) via "Publicar porta", recurso que já existe.
- Log de atividade do sistema inteiro (quem logou no Velix, quem fez o quê em qualquer tela) — combinado como projeto separado, tratado depois deste.
- Múltiplas conexões/abas simultâneas dentro da mesma sessão de navegador — um túnel por vez por banco aberto.
- Trocar de banco/schema dentro da tela — fica fixo no banco padrão criado pelo Velix (`DATABASE_NAME`), pros três motores.

**Remove nesta entrega:** o botão "Abrir interface web"/Adminer e todo o fluxo de domínio automático (`AdminerDeployButton.tsx`, manifesto `adminer.ts`, os endpoints que ele chamava ficam intactos pois são genéricos). A tela nova cobre o caso de uso que o Adminer cobria e evita reintroduzir a classe de bug já vista nesta sessão (domínio automático, DNS, certificado).

## 2. Arquitetura

### 2.1 Por que não dá pra conectar direto
O container do banco só existe na rede Docker `velix-proxy` do servidor gerenciado — a API do Velix não tem rota de rede até lá (por isso o Adminer/domínio existia: outro container na mesma rede Docker consegue resolver o nome via DNS interno). Pra rodar queries de verdade (não só `docker exec` com o CLI, que serializa tudo em texto e não dá pra parsear com segurança pra uma grade de dados), a API precisa abrir uma conexão TCP real até o processo do banco.

### 2.2 Túnel SSH efêmero + driver nativo
Reaproveita a infraestrutura SSH que já existe (`ssh2`, já é dependência) em vez de expor a porta do banco:

1. Resolve o IP do container na rede `velix-proxy` via SSH: `docker inspect <containerName> --format '{{.NetworkSettings.Networks.velix-proxy.IPAddress}}'`.
2. Abre uma conexão SSH até o servidor gerenciado e usa `Client.forwardOut('127.0.0.1', 0, containerIp, port, cb)` (API nativa do `ssh2`, sem porta local exposta no host) — o resultado é um stream duplex.
3. Passa esse stream pro driver nativo do banco como conexão já estabelecida:
   - MySQL/MariaDB: `mysql2` (dependência nova — `createConnection({ stream, user, password, database })`).
   - PostgreSQL: `pg` (dependência nova — `new Client({ stream, user, password, database })`, ambos suportam `stream` customizado).
4. Uma conexão por sessão de aba aberta na tela "Dados" — fecha quando o usuário sai da aba ou depois de alguns minutos sem uso (mesmo espírito do WebTerminal, que já gerencia sessões via WebSocket).

`mysql2` e `pg` são os drivers padrão de cada banco no ecossistema Node — não existe alternativa razoável sem reimplementar o protocolo binário de cada um.

### 2.3 Autenticação automática
Sem tela de login (diferente do Adminer): usa a senha já gerada no deploy.
- Usuário: `root` (MySQL/MariaDB) ou `postgres` (PostgreSQL) — fixo, é sempre o superusuário criado pela imagem oficial.
- Senha: `getCredentials(deploymentId)` já existente → `ROOT_PASSWORD` (MySQL/MariaDB) ou `POSTGRES_PASSWORD` (PostgreSQL).
- Banco/schema padrão: `getEnv(deploymentId)` já existente → variável `DATABASE_NAME` (fallback `"app"`, mesmo default do manifesto). Fica fixo no banco padrão pros três motores nesta fase — sem seletor pra trocar de schema/banco (adiciona uma conexão nova por troca, mais complexidade de UI; cobre o caso comum de "um banco por projeto" que é como o Velix cria hoje).

### 2.4 Transporte com o frontend
REST simples (não WebSocket) — cada ação da tela (listar tabelas, ver página de linhas, rodar uma query) é uma requisição HTTP que abre o túnel, executa, devolve JSON e fecha. Mais simples que manter uma conexão viva por WebSocket, e como cada chamada leva no máximo alguns segundos (mesmo timeout de outras rotas HTTP da API), não precisa de streaming.

## 3. Modelo de dados (migração Prisma nova — só `CREATE TABLE`, sem `ALTER TYPE`)

```prisma
model DatabaseQueryLog {
  id               String         @id @default(uuid())
  projectServiceId String
  projectService   ProjectService @relation(fields: [projectServiceId], references: [id], onDelete: Cascade)
  userId           String
  user             User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  query      String   @db.Text
  ok         Boolean
  rowCount   Int?
  error      String?
  executedAt DateTime @default(now())

  @@index([projectServiceId, executedAt])
}
```

`ProjectService` e `User` ganham a relação inversa (`queryLogs DatabaseQueryLog[]`). Só o editor de SQL grava aqui — a navegação de tabelas/linhas (somente leitura, gerada pelo Velix, não digitada pelo usuário) não precisa de auditoria de "o que foi digitado".

## 4. Backend — módulo novo `src/database-console/`

Nome escolhido pra não colidir com `src/database/` (sistema órfão `DatabaseInstance`) nem `src/database-backup/` (backups):

- **`database-tunnel.service.ts`**: função central `withConnection(projectServiceId, fn)` — resolve o `ProjectService`/`ProjectDeployment`, credencial e banco padrão, abre o túnel SSH + conexão do driver certo pro engine (`postgresql`/`mysql`/`mariadb`, mesma detecção de imagem que `engineLabel`/`looksLikeDatabase` já fazem), roda `fn(conn)`, garante que a conexão e o túnel fecham no `finally` (sucesso ou erro).
- **`database-console.service.ts`**:
  - `listTables(projectServiceId)`: `SHOW TABLES` + `SELECT COUNT(*)` por tabela (MySQL/MariaDB) ou consulta em `information_schema.tables`/`pg_stat_user_tables` (Postgres).
  - `getRows(projectServiceId, table, { page, pageSize, search })`: `SELECT * FROM <table> LIMIT/OFFSET` com identificador da tabela validado contra a lista de `listTables` (nunca interpolado sem checagem — mesma lição de injeção da v1.15.2) e busca opcional aplicada como `WHERE` sobre colunas de texto.
  - `runQuery(projectServiceId, userId, sql)`: executa o SQL como o usuário digitou (sem filtro de comando — é a área "avançada", equivalente ao editor SQL do Adminer), grava o resultado em `DatabaseQueryLog` (sucesso/linhas afetadas ou erro), devolve linhas (se for `SELECT`) ou `{rowsAffected}`.
  - `listQueryLog(projectServiceId)`: últimas execuções, mais recente primeiro.
- **`database-console.controller.ts`**: `GET /databases/:id/tables`, `GET /databases/:id/tables/:table/rows`, `POST /databases/:id/query`, `GET /databases/:id/query-log`. Leitura exige `JwtAuthGuard` (qualquer papel); `POST /query` exige `@MinRole('operator')` — mesma convenção do resto da API, já que roda comandos arbitrários.

## 5. Frontend

- Nova aba **"Dados"** em `app/(dashboard)/databases/[id]/page.tsx`, ao lado de Conexão/Backups (a página vira uma navegação por abas, hoje é uma coluna única — pequeno ajuste de layout pra caber a aba nova sem overload de scroll).
- Layout responsivo em duas colunas no desktop (empilha no mobile): lista de tabelas à esquerda (nome + contagem de linhas, clicável), grade de linhas à direita com paginação e busca simples por texto.
- Editor SQL colapsável abaixo da grade — textarea com highlight leve (reaproveita a fonte monoespaçada já usada nos outros editores da UI), botão "Executar", resultado como tabela (se `SELECT`) ou mensagem de sucesso/erro, e a lista do histórico (`query-log`) logo abaixo, mais recente primeiro.
- Remove `AdminerDeployButton` da tela (`databases/[id]/page.tsx` e `projects/[id]/services/[name]/page.tsx`) — o componente e o manifesto `adminer.ts` ficam no repositório mas sem nenhum ponto de entrada na UI (remoção limpa do código morto fica pra uma limpeza separada, não é o foco desta entrega).

## 6. Segurança

- `runQuery` roda com o mesmo privilégio do usuário root/postgres do container — é a mesma superfície de risco que o Adminer já tinha (login automático com a senha root), não uma regressão.
- Nome de tabela em `getRows` é sempre validado contra o resultado de `listTables` antes de entrar num identificador SQL — nunca interpolado direto do parâmetro da URL.
- `POST /query` exige `@MinRole('operator')` (mutação arbitrária) — leitura de tabelas/linhas exige só `JwtAuthGuard`.
- Túnel fecha sempre no `finally` de `withConnection` — sem conexão pendurada mesmo se a query falhar ou o driver lançar exceção.

## 7. Testes / verificação

Mesmo padrão desta sessão: `tsc --noEmit` + `nest build` na API, self-check de DI (`app.module.spec.ts`), `*.util.spec.ts` via `ts-node` pra qualquer função pura (validação de nome de tabela, montagem de `LIMIT/OFFSET`), `tsc --noEmit` + `next build` no frontend. **Não é possível testar o túnel SSH + driver contra um banco real neste ambiente** (sem Docker/servidor real) — é a parte de maior risco desta entrega (mecanismo novo, nunca exercitado nesta base de código) e precisa ser testada contra um servidor real antes de confiar em produção, com atenção especial a: MySQL vs MariaDB (mesma porta/protocolo, deve funcionar igual), PostgreSQL (protocolo diferente, driver `pg` nunca usado nesta base antes), e o caso de erro (banco parado, credencial errada) não travando o túnel aberto.
