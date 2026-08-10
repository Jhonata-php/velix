'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { DatabaseTableInfo, DatabaseRowsResult, DatabaseQueryResult, DatabaseQueryLogEntry } from '@/lib/types';
import { Alert } from './Alert';
import { EmptyState, ErrorState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { IconLayers, IconSearch, IconTerminal, IconClock, IconChevronDown, IconPlus, IconDatabase } from './icons';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Mesma detecção de imagem já usada em vários outros pontos do app (backend
 * e frontend) — só decide qual sintaxe de CREATE TABLE sugerir no editor,
 * nada crítico se errar (o usuário sempre pode editar antes de executar). */
function engineOf(image: string): 'postgresql' | 'mysql' | 'mariadb' {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'postgresql';
  if (img.includes('mariadb')) return 'mariadb';
  return 'mysql';
}

function createTableTemplate(engine: 'postgresql' | 'mysql' | 'mariadb'): string {
  if (engine === 'postgresql') {
    return 'CREATE TABLE nome_da_tabela (\n  id SERIAL PRIMARY KEY,\n  criado_em TIMESTAMP DEFAULT NOW()\n);';
  }
  return 'CREATE TABLE nome_da_tabela (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP\n);';
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

export function DatabaseDataTab({ databaseId, image }: { databaseId: string; image: string }) {
  const engine = engineOf(image);

  const [tables, setTables] = useState<DatabaseTableInfo[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rowsResult, setRowsResult] = useState<DatabaseRowsResult | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const [showSqlEditor, setShowSqlEditor] = useState(false);
  const [sqlText, setSqlText] = useState('');
  const [runningSql, setRunningSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<DatabaseQueryResult | { error: string } | null>(null);
  const [queryLog, setQueryLog] = useState<DatabaseQueryLogEntry[] | null>(null);

  function loadTables() {
    apiFetch<DatabaseTableInfo[]>(`/databases/${databaseId}/tables`)
      .then((list) => {
        setTables(list);
        setTablesError(null);
      })
      .catch((e) => setTablesError(e instanceof Error ? e.message : 'Falha ao carregar tabelas'));
  }

  function loadQueryLog() {
    apiFetch<DatabaseQueryLogEntry[]>(`/databases/${databaseId}/query-log`)
      .then(setQueryLog)
      .catch(() => {});
  }

  useEffect(() => {
    loadTables();
    loadQueryLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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

  function selectTable(name: string) {
    setSelectedTable(name);
    setPage(1);
    setSearchInput('');
    setSearch('');
  }

  /** Pré-preenche o editor com um esqueleto de CREATE TABLE pronto pra editar
   * — não é um formulário visual de colunas (mais barato de construir e
   * cobre bem o caso "quero criar uma tabela agora"), mas poupa quem não
   * lembra a sintaxe de cor de digitar do zero. */
  function openCreateTable() {
    setSqlText(createTableTemplate(engine));
    setShowSqlEditor(true);
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
      loadTables();
    }
  }

  const totalPages = rowsResult ? Math.max(1, Math.ceil(rowsResult.total / rowsResult.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr] lg:items-stretch">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="section-label flex items-center gap-1.5">
              <IconLayers className="h-3.5 w-3.5" aria-hidden />
              Tabelas
            </p>
            <button
              onClick={openCreateTable}
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <IconPlus className="h-3.5 w-3.5" aria-hidden />
              Nova tabela
            </button>
          </div>

          {tablesError ? (
            <ErrorState message={tablesError} onRetry={loadTables} />
          ) : !tables ? (
            <div className="card p-3">
              <Skeleton className="h-32" />
            </div>
          ) : tables.length === 0 ? (
            <EmptyState
              icon={<IconLayers className="h-4 w-4" aria-hidden />}
              title="Nenhuma tabela ainda"
              description="Crie a primeira tabela direto por aqui, ou importe um .sql na aba Conexão."
              action={
                <button onClick={openCreateTable} className="btn-secondary px-3 py-1.5 text-xs">
                  Criar tabela
                </button>
              }
            />
          ) : (
            <div className="card flex-1 space-y-0.5 overflow-y-auto p-2 lg:max-h-[520px]">
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

        {!selectedTable ? (
          <EmptyState
            icon={<IconDatabase className="h-4 w-4" aria-hidden />}
            title="Selecione uma tabela"
            description="Escolha uma tabela na lista ao lado pra ver as linhas, ou crie uma nova."
          />
        ) : (
          <div className="card flex flex-1 flex-col space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="section-label">{selectedTable}</p>
              <div className="relative">
                <IconSearch
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
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
          </div>
        )}
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
              rows={6}
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
                <>
                  <DataTable columns={sqlResult.columns} rows={sqlResult.rows} />
                  {sqlResult.truncated && <p className="text-[11px] text-amber-500">Resultado truncado em 500 linhas.</p>}
                </>
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
