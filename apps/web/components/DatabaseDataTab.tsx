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
