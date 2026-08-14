import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { dbImportSecretKey } from '../terminal/container-shell.util';
import { CatalogService } from '../catalog/catalog.service';
import { resolvedDatabaseName } from '../catalog/catalog.util';
import { DatabaseTunnelService, type DbConnection } from './database-tunnel.service';
import { isKnownTable, paginate, type DbEngine } from './database-console.util';

export interface TableInfo {
  name: string;
  rowCount: number | null;
}

export interface RowsResult {
  columns: string[];
  /** Colunas que formam a chave primária — vazio quando a tabela não tem
   * nenhuma. É o que decide se a grade pode ou não editar/excluir linha:
   * sem chave primária não existe WHERE que identifique UMA linha, e um
   * UPDATE por valor bateria em várias de uma vez. */
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

interface ColumnInfo {
  name: string;
  primaryKey: boolean;
}

export interface QueryExecResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number | null;
  truncated: boolean;
}

const RUN_QUERY_ROW_CAP = 500;

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

// information_schema/pg_catalog não contam como "banco do usuário" — mesma
// lista que o Adminer já esconde por padrão.
const MYSQL_SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);
const PG_SYSTEM_SCHEMAS = new Set(['template0', 'template1']);

/** Envolve um nome de tabela/coluna já confirmado contra o schema real num
 * identificador SQL seguro — a validação (isKnownTable/lista de colunas)
 * garante que o nome existe, mas não escapa aspas embutidas no próprio nome
 * (ex.: tabela literalmente chamada `a"b`), então isso ainda é necessário
 * antes de interpolar. */
function quoteIdent(name: string, engine: DbEngine): string {
  if (engine === 'postgresql') return `"${name.replace(/"/g, '""')}"`;
  return `\`${name.replace(/`/g, '``')}\``;
}

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
    private readonly catalog: CatalogService,
  ) {}

  private async fetchTables(conn: DbConnection, engine: DbEngine): Promise<TableInfo[]> {
    const sql = engine === 'postgresql' ? PG_LIST_TABLES_SQL : MYSQL_LIST_TABLES_SQL;
    const { rows } = await conn.query(sql);
    return rows.map((r) => ({
      name: String(r.name),
      rowCount: r.rowCount == null ? null : Number(r.rowCount),
    }));
  }

  private async listColumns(conn: DbConnection, engine: DbEngine, table: string): Promise<ColumnInfo[]> {
    if (engine === 'postgresql') {
      const { rows } = await conn.query(
        `SELECT c.column_name AS name, (pk.column_name IS NOT NULL) AS is_pk
         FROM information_schema.columns c
         LEFT JOIN (
           SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
         ) pk ON pk.column_name = c.column_name
         WHERE c.table_schema = 'public' AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [table, table],
      );
      return rows.map((r) => ({ name: String(r.name), primaryKey: r.is_pk === true }));
    }
    const { rows } = await conn.query(
      `SELECT column_name AS name, column_key AS ckey
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      [table],
    );
    return rows.map((r) => ({ name: String(r.name), primaryKey: String(r.ckey ?? '') === 'PRI' }));
  }

  /** Valida tabela + colunas contra o schema real e devolve o identificador
   * já escapado — todo caminho de escrita (update/delete de linha) passa por
   * aqui antes de montar SQL, pra nunca interpolar um nome que não foi
   * confirmado no banco. */
  private async resolveWritableTable(
    conn: DbConnection,
    engine: DbEngine,
    table: string,
    referencedColumns: string[],
  ): Promise<{ tableIdent: string; columns: ColumnInfo[] }> {
    const known = (await this.fetchTables(conn, engine)).map((t) => t.name);
    if (!isKnownTable(table, known)) throw new BadRequestException(`Tabela "${table}" não existe neste banco.`);
    const columns = await this.listColumns(conn, engine, table);
    const names = new Set(columns.map((c) => c.name));
    for (const name of referencedColumns) {
      if (!names.has(name)) throw new BadRequestException(`Coluna "${name}" não existe em "${table}".`);
    }
    return { tableIdent: quoteIdent(table, engine), columns };
  }

  /** Bancos/schemas existentes na mesma instância (servidor) — pra deixar
   * trocar de banco na tela sem precisar de outra implantação. MySQL/MariaDB
   * enxergam a instância toda de qualquer conexão; Postgres só enxerga outros
   * bancos via `pg_database` mesmo conectado a um específico. */
  listSchemas(projectServiceId: string): Promise<string[]> {
    return this.tunnel.withConnection(
      projectServiceId,
      async (conn, engine) => {
        if (engine === 'postgresql') {
          const { rows } = await conn.query(`SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname`);
          return rows.map((r) => String(r.name)).filter((name) => !PG_SYSTEM_SCHEMAS.has(name));
        }
        const { rows } = await conn.query('SHOW DATABASES');
        return rows.map((r) => String(r['Database'] ?? r.name)).filter((name) => !MYSQL_SYSTEM_SCHEMAS.has(name));
      },
      undefined,
      false,
    );
  }

  /** DATABASE_NAME da implantação — é o banco que `withConnection` usa como
   * padrão sempre que ninguém pede outro explicitamente (navegação de
   * tabelas, editor SQL sem seletor). Excluí-lo derrubava o console inteiro
   * (toda reconexão caía em "Unknown database"), então `dropDatabase` recusa
   * excluir esse banco especificamente. */
  private async getDefaultDatabaseName(projectServiceId: string): Promise<string> {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) return 'app';
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    const variables = deployment?.variablesJson ? (JSON.parse(deployment.variablesJson) as Record<string, string>) : {};
    const manifest = deployment?.manifestSlug ? this.catalog.getManifestSafe(deployment.manifestSlug) : null;
    return resolvedDatabaseName(manifest, service.name, variables);
  }

  /**
   * Troca a senha do usuário administrador (root/postgres) — roda o ALTER
   * de verdade no banco e só depois atualiza o segredo cifrado guardado na
   * implantação, pra nunca ficar com os dois lados fora de sincronia: se o
   * ALTER falhar, nada muda; se o ALTER passar mas salvar o segredo novo
   * falhar, o console fica destrancado com a senha antiga (raro — é só uma
   * escrita no Postgres do próprio Velix). `USER()`/`CURRENT_USER` em vez de
   * `'root'@'%'` fixo: evita apostar em qual host a imagem oficial usa (varia
   * entre versões), sempre acerta o usuário com quem a conexão já autenticou.
   */
  async changeRootPassword(projectServiceId: string, newPassword?: string): Promise<{ password: string }> {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) throw new NotFoundException('Banco não encontrado');
    const secretKey = dbImportSecretKey(service.image);
    if (!secretKey) {
      throw new BadRequestException('Este banco não usa um formato de credenciais compatível com o console embutido.');
    }

    const password = newPassword?.trim() || randomBytes(12).toString('base64url');

    try {
      await this.tunnel.withConnection(
        projectServiceId,
        async (conn, engine) => {
          if (engine === 'postgresql') {
            await conn.query('ALTER USER CURRENT_USER WITH PASSWORD $1', [password]);
          } else {
            await conn.query('ALTER USER USER() IDENTIFIED BY ?', [password]);
          }
        },
        undefined,
        false,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Falha ao trocar a senha');
    }

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    const secrets = deployment?.secretsEnc ? (JSON.parse(decryptCredential(deployment.secretsEnc)) as Record<string, string>) : {};
    secrets[secretKey] = password;
    await this.prisma.projectDeployment.update({
      where: { id: service.deploymentId },
      data: { secretsEnc: encryptCredential(JSON.stringify(secrets)) },
    });

    return { password };
  }

  async createDatabase(projectServiceId: string, name: string): Promise<void> {
    try {
      await this.tunnel.withConnection(
        projectServiceId,
        async (conn, engine) => {
          const ident = quoteIdent(name, engine);
          await conn.query(`CREATE DATABASE ${ident}`);
        },
        undefined,
        false,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Falha ao criar o banco');
    }
  }

  async dropDatabase(projectServiceId: string, name: string): Promise<void> {
    const defaultDb = await this.getDefaultDatabaseName(projectServiceId);
    if (name === defaultDb) {
      throw new BadRequestException(
        `"${name}" é o banco padrão deste projeto — excluir ele travaria o console (toda navegação volta pra ele por padrão). Use o Editor SQL se precisar mesmo assim.`,
      );
    }
    try {
      await this.tunnel.withConnection(
        projectServiceId,
        async (conn, engine) => {
          const ident = quoteIdent(name, engine);
          await conn.query(`DROP DATABASE ${ident}`);
        },
        undefined,
        false,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Falha ao excluir o banco');
    }
  }

  listTables(projectServiceId: string, database?: string): Promise<TableInfo[]> {
    return this.tunnel.withConnection(projectServiceId, (conn, engine) => this.fetchTables(conn, engine), database);
  }

  getRows(
    projectServiceId: string,
    table: string,
    opts: { page: number; pageSize: number; search?: string; database?: string },
  ): Promise<RowsResult> {
    return this.tunnel.withConnection(projectServiceId, async (conn, engine) => {
      const { tableIdent, columns: columnInfos } = await this.resolveWritableTable(conn, engine, table, []);
      const columns = columnInfos.map((c) => c.name);
      const { limit, offset } = paginate(opts.page, opts.pageSize);

      let whereClause = '';
      let whereParams: unknown[] = [];
      const search = opts.search?.trim();
      if (search && columns.length > 0) {
        const needle = `%${search}%`;
        if (engine === 'postgresql') {
          whereClause = `WHERE ${columns.map((c) => `${quoteIdent(c, engine)}::text ILIKE $1`).join(' OR ')}`;
          whereParams = [needle];
        } else {
          whereClause = `WHERE ${columns.map((c) => `CAST(${quoteIdent(c, engine)} AS CHAR) LIKE ?`).join(' OR ')}`;
          whereParams = columns.map(() => needle);
        }
      }

      const { rows: countRows } = await conn.query(`SELECT COUNT(*) AS total FROM ${tableIdent} ${whereClause}`, whereParams);
      const total = Number(countRows[0]?.total ?? 0);

      const dataSql =
        engine === 'postgresql'
          ? `SELECT * FROM ${tableIdent} ${whereClause} LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
          : `SELECT * FROM ${tableIdent} ${whereClause} LIMIT ? OFFSET ?`;
      const { rows } = await conn.query(dataSql, [...whereParams, limit, offset]);

      return {
        columns,
        primaryKeys: columnInfos.filter((c) => c.primaryKey).map((c) => c.name),
        rows,
        total,
        page: opts.page,
        pageSize: opts.pageSize,
      };
    }, opts.database);
  }

  /**
   * Altera UMA linha, identificada pela chave primária. Toda escrita vai
   * parametrizada (nunca interpolada) e o nome de tabela/coluna passa por
   * `resolveWritableTable` antes de virar identificador. A chave primária é
   * obrigatória de propósito: sem ela, um UPDATE por valor de coluna comum
   * poderia atingir várias linhas de uma vez sem o usuário perceber.
   */
  async updateRow(
    projectServiceId: string,
    userId: string,
    table: string,
    opts: { pk: Record<string, unknown>; changes: Record<string, unknown>; database?: string },
  ): Promise<void> {
    const pkEntries = Object.entries(opts.pk);
    const changeEntries = Object.entries(opts.changes);
    if (pkEntries.length === 0) {
      throw new BadRequestException('Esta tabela não tem chave primária — edite pelo editor SQL.');
    }
    if (changeEntries.length === 0) throw new BadRequestException('Nenhuma alteração informada.');

    await this.runWrite(projectServiceId, userId, opts.database, async (conn, engine) => {
      const referenced = [...pkEntries.map(([k]) => k), ...changeEntries.map(([k]) => k)];
      const { tableIdent } = await this.resolveWritableTable(conn, engine, table, referenced);

      let i = 1;
      const placeholder = () => (engine === 'postgresql' ? `$${i++}` : '?');
      const setSql = changeEntries.map(([k]) => `${quoteIdent(k, engine)} = ${placeholder()}`).join(', ');
      const whereSql = pkEntries.map(([k]) => `${quoteIdent(k, engine)} = ${placeholder()}`).join(' AND ');
      const sql = `UPDATE ${tableIdent} SET ${setSql} WHERE ${whereSql}`;
      const params = [...changeEntries.map(([, v]) => v), ...pkEntries.map(([, v]) => v)];
      const result = await conn.query(sql, params);
      return { sql, rowCount: result.rowCount };
    });
  }

  async deleteRow(
    projectServiceId: string,
    userId: string,
    table: string,
    opts: { pk: Record<string, unknown>; database?: string },
  ): Promise<void> {
    const pkEntries = Object.entries(opts.pk);
    if (pkEntries.length === 0) {
      throw new BadRequestException('Esta tabela não tem chave primária — exclua pelo editor SQL.');
    }

    await this.runWrite(projectServiceId, userId, opts.database, async (conn, engine) => {
      const { tableIdent } = await this.resolveWritableTable(
        conn,
        engine,
        table,
        pkEntries.map(([k]) => k),
      );
      let i = 1;
      const whereSql = pkEntries
        .map(([k]) => `${quoteIdent(k, engine)} = ${engine === 'postgresql' ? `$${i++}` : '?'}`)
        .join(' AND ');
      const sql = `DELETE FROM ${tableIdent} WHERE ${whereSql}`;
      const result = await conn.query(
        sql,
        pkEntries.map(([, v]) => v),
      );
      return { sql, rowCount: result.rowCount };
    });
  }

  /** Executa uma escrita da grade e registra no mesmo histórico do editor
   * SQL — uma edição feita clicando na célula muda dado igual a um UPDATE
   * digitado à mão, então precisa aparecer na auditoria do mesmo jeito. */
  private async runWrite(
    projectServiceId: string,
    userId: string,
    database: string | undefined,
    fn: (conn: DbConnection, engine: DbEngine) => Promise<{ sql: string; rowCount: number | null }>,
  ): Promise<void> {
    let attempted = '(comando não chegou a ser montado)';
    try {
      const { sql, rowCount } = await this.tunnel.withConnection(
        projectServiceId,
        async (conn, engine) => {
          const outcome = await fn(conn, engine);
          attempted = outcome.sql;
          return outcome;
        },
        database,
      );
      await this.prisma.databaseQueryLog.create({ data: { projectServiceId, userId, query: sql, ok: true, rowCount } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao alterar a linha';
      await this.prisma.databaseQueryLog.create({
        data: { projectServiceId, userId, query: attempted, ok: false, error: message },
      });
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(message);
    }
  }

  async runQuery(projectServiceId: string, userId: string, sql: string, database?: string): Promise<QueryExecResult> {
    const trimmed = sql.trim();
    if (!trimmed) throw new BadRequestException('Informe um comando SQL.');

    try {
      const result = await this.tunnel.withConnection(projectServiceId, (conn) => conn.query(trimmed), database);
      await this.prisma.databaseQueryLog.create({
        data: { projectServiceId, userId, query: trimmed, ok: true, rowCount: result.rowCount },
      });
      const columns = result.rows[0] ? Object.keys(result.rows[0]) : [];
      const truncated = result.rows.length > RUN_QUERY_ROW_CAP;
      return {
        columns,
        rows: truncated ? result.rows.slice(0, RUN_QUERY_ROW_CAP) : result.rows,
        rowsAffected: result.rows.length === 0 ? result.rowCount : null,
        truncated,
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
