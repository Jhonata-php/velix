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

  /** Bancos/schemas existentes na mesma instância (servidor) — pra deixar
   * trocar de banco na tela sem precisar de outra implantação. MySQL/MariaDB
   * enxergam a instância toda de qualquer conexão; Postgres só enxerga outros
   * bancos via `pg_database` mesmo conectado a um específico. */
  listSchemas(projectServiceId: string): Promise<string[]> {
    return this.tunnel.withConnection(projectServiceId, async (conn, engine) => {
      if (engine === 'postgresql') {
        const { rows } = await conn.query(`SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname`);
        return rows.map((r) => String(r.name)).filter((name) => !PG_SYSTEM_SCHEMAS.has(name));
      }
      const { rows } = await conn.query('SHOW DATABASES');
      return rows.map((r) => String(r['Database'] ?? r.name)).filter((name) => !MYSQL_SYSTEM_SCHEMAS.has(name));
    });
  }

  async createDatabase(projectServiceId: string, name: string): Promise<void> {
    await this.tunnel.withConnection(projectServiceId, async (conn, engine) => {
      const ident = quoteIdent(name, engine);
      await conn.query(`CREATE DATABASE ${ident}`);
    });
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
          whereClause = `WHERE ${columns.map((c) => `${quoteIdent(c, engine)}::text ILIKE $1`).join(' OR ')}`;
          whereParams = [needle];
        } else {
          whereClause = `WHERE ${columns.map((c) => `CAST(${quoteIdent(c, engine)} AS CHAR) LIKE ?`).join(' OR ')}`;
          whereParams = columns.map(() => needle);
        }
      }

      const tableIdent = quoteIdent(table, engine);
      const { rows: countRows } = await conn.query(`SELECT COUNT(*) AS total FROM ${tableIdent} ${whereClause}`, whereParams);
      const total = Number(countRows[0]?.total ?? 0);

      const dataSql =
        engine === 'postgresql'
          ? `SELECT * FROM ${tableIdent} ${whereClause} LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
          : `SELECT * FROM ${tableIdent} ${whereClause} LIMIT ? OFFSET ?`;
      const { rows } = await conn.query(dataSql, [...whereParams, limit, offset]);

      return { columns, rows, total, page: opts.page, pageSize: opts.pageSize };
    }, opts.database);
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
