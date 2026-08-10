'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { DatabaseTableInfo, DatabaseRowsResult, DatabaseQueryResult, DatabaseQueryLogEntry } from '@/lib/types';
import { Alert } from './Alert';
import { EmptyState, ErrorState } from './EmptyState';
import { Modal, ConfirmModal } from './Modal';
import { SqlImportButton } from './SqlImportButton';
import { Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { IconLayers, IconSearch, IconTerminal, IconClock, IconPlus, IconDatabase, IconChevronDown, IconTrash } from './icons';

type DbEngine = 'postgresql' | 'mysql' | 'mariadb';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Mesma detecção de imagem já usada em vários outros pontos do app (backend
 * e frontend) — só decide a sintaxe SQL certa pros modais desta tela; nada
 * crítico se errar (sempre dá pra editar o SQL antes de executar). */
function engineOf(image: string): DbEngine {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'postgresql';
  if (img.includes('mariadb')) return 'mariadb';
  return 'mysql';
}

function quoteIdent(name: string, engine: DbEngine): string {
  return engine === 'postgresql' ? `"${name}"` : `\`${name}\``;
}

function insertTemplate(table: string, columns: string[], engine: DbEngine): string {
  const cols = columns.filter((c) => c.toLowerCase() !== 'id');
  const list = cols.length > 0 ? cols : ['coluna1', 'coluna2'];
  return `INSERT INTO ${quoteIdent(table, engine)} (${list.map((c) => quoteIdent(c, engine)).join(', ')})\nVALUES (${list.map(() => "''").join(', ')});`;
}

/** Colunas com valor grande (JSON, texto longo) faziam a tabela esticar sem
 * limite, obrigando a rolar a página inteira na horizontal em vez de só a
 * tabela — cada célula agora trunca com "..." num teto de largura, com o
 * valor completo disponível no title (tooltip nativo ao passar o mouse). */
function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>
            {columns.map((c) => (
              <th key={c} className="max-w-[240px] truncate px-3 py-2 font-medium text-slate-500" title={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const value = formatCell(row[c]);
                return (
                  <td key={c} className="max-w-[240px] truncate px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200" title={value}>
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-center text-sm text-slate-400">Nenhuma linha encontrada.</p>}
    </div>
  );
}

/** Editor SQL livre — vive num modal compacto (aberto por um botão pequeno
 * no canto) em vez de uma barra ocupando a largura toda, pra sobrar espaço
 * pra grade de dados, que é o que se olha com mais frequência. */
function SqlEditorModal({
  databaseId,
  database,
  initialSql,
  onClose,
  onRan,
}: {
  databaseId: string;
  database: string | null;
  initialSql: string;
  onClose: () => void;
  onRan: () => void;
}) {
  const [sqlText, setSqlText] = useState(initialSql);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DatabaseQueryResult | { error: string } | null>(null);
  const [queryLog, setQueryLog] = useState<DatabaseQueryLogEntry[] | null>(null);

  function loadQueryLog() {
    apiFetch<DatabaseQueryLogEntry[]>(`/databases/${databaseId}/query-log`)
      .then(setQueryLog)
      .catch(() => {});
  }

  useEffect(loadQueryLog, [databaseId]);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await apiFetch<DatabaseQueryResult>(`/databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql: sqlText, database: database ?? undefined }),
      });
      setResult(r);
      onRan();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Falha ao executar o comando' });
    } finally {
      setRunning(false);
      loadQueryLog();
    }
  }

  return (
    <Modal title={database ? `Editor SQL — ${database}` : 'Editor SQL'} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <textarea
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
          rows={6}
          placeholder="SELECT * FROM ..."
          autoFocus
          className="input font-mono text-xs"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            Roda com o usuário administrador do banco — cuidado com UPDATE/DELETE sem WHERE.
          </p>
          <button onClick={run} disabled={running || !sqlText.trim()} className="btn-primary shrink-0 px-3.5 py-1.5 text-sm disabled:opacity-50">
            {running ? 'Executando...' : 'Executar'}
          </button>
        </div>

        {result && 'error' in result && <Alert variant="error">{result.error}</Alert>}
        {result &&
          'columns' in result &&
          (result.rowsAffected != null ? (
            <Alert variant="success">{result.rowsAffected} linha(s) afetada(s).</Alert>
          ) : (
            <>
              <DataTable columns={result.columns} rows={result.rows} />
              {result.truncated && <p className="text-[11px] text-amber-500">Resultado truncado em 500 linhas.</p>}
            </>
          ))}

        {queryLog && queryLog.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
              <IconClock className="h-3.5 w-3.5" aria-hidden />
              Histórico
            </p>
            <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
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
      </div>
    </Modal>
  );
}

type ColumnType = 'INT' | 'BIGINT' | 'VARCHAR' | 'TEXT' | 'BOOLEAN' | 'DATETIME' | 'DECIMAL';

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  INT: 'Número inteiro',
  BIGINT: 'Número inteiro (grande)',
  VARCHAR: 'Texto curto',
  TEXT: 'Texto longo',
  BOOLEAN: 'Verdadeiro/falso',
  DATETIME: 'Data e hora',
  DECIMAL: 'Número decimal',
};

interface ColumnDraft {
  name: string;
  type: ColumnType;
  primaryKey: boolean;
  nullable: boolean;
}

function columnSqlType(type: ColumnType, engine: DbEngine): string {
  if (type === 'VARCHAR') return 'VARCHAR(255)';
  if (type === 'DECIMAL') return 'DECIMAL(10,2)';
  if (type === 'DATETIME') return engine === 'postgresql' ? 'TIMESTAMP' : 'DATETIME';
  return type;
}

function buildCreateTableSql(tableName: string, columns: ColumnDraft[], engine: DbEngine): string {
  const lines = columns
    .filter((c) => c.name.trim())
    .map((c) => {
      const ident = quoteIdent(c.name.trim(), engine);
      if (c.primaryKey && (c.type === 'INT' || c.type === 'BIGINT')) {
        if (engine === 'postgresql') return `${ident} ${c.type === 'BIGINT' ? 'BIGSERIAL' : 'SERIAL'} PRIMARY KEY`;
        return `${ident} ${c.type} AUTO_INCREMENT PRIMARY KEY`;
      }
      const parts = [ident, columnSqlType(c.type, engine)];
      if (!c.nullable) parts.push('NOT NULL');
      if (c.primaryKey) parts.push('PRIMARY KEY');
      return parts.join(' ');
    });
  return `CREATE TABLE ${quoteIdent(tableName, engine)} (\n  ${lines.join(',\n  ')}\n);`;
}

/** Modal de criação de tabela guiado por formulário (nome + colunas) em vez
 * de pedir pra digitar SQL na mão — gera o CREATE TABLE certo pro motor do
 * banco e roda pelo mesmo endpoint do editor livre, sem rota nova. */
function CreateTableModal({
  databaseId,
  database,
  engine,
  onClose,
  onCreated,
}: {
  databaseId: string;
  database: string | null;
  engine: DbEngine;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { name: 'id', type: 'INT', primaryKey: true, nullable: false },
    { name: 'criado_em', type: 'DATETIME', primaryKey: false, nullable: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateColumn(i: number, patch: Partial<ColumnDraft>) {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function addColumn() {
    setColumns((prev) => [...prev, { name: '', type: 'VARCHAR', primaryKey: false, nullable: true }]);
  }

  function removeColumn(i: number) {
    setColumns((prev) => prev.filter((_, idx) => idx !== i));
  }

  const valid = tableName.trim().length > 0 && columns.some((c) => c.name.trim());

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql: buildCreateTableSql(tableName.trim(), columns, engine), database: database ?? undefined }),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar a tabela');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nova tabela" onClose={saving ? undefined : onClose} closeDisabled={saving} maxWidth="max-w-lg">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome da tabela</span>
          <input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="clientes" className="input" />
        </label>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">Colunas</p>
          <div className="space-y-2">
            {columns.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <input
                  value={c.name}
                  onChange={(e) => updateColumn(i, { name: e.target.value })}
                  placeholder="nome_da_coluna"
                  className="input h-8 min-w-0 flex-1 text-xs"
                />
                <select value={c.type} onChange={(e) => updateColumn(i, { type: e.target.value as ColumnType })} className="input h-8 w-36 text-xs">
                  {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                    <option key={t} value={t}>
                      {COLUMN_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  <input type="checkbox" checked={c.primaryKey} onChange={(e) => updateColumn(i, { primaryKey: e.target.checked })} />
                  Chave primária
                </label>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  <input type="checkbox" checked={c.nullable} onChange={(e) => updateColumn(i, { nullable: e.target.checked })} />
                  Permite nulo
                </label>
                <button
                  onClick={() => removeColumn(i)}
                  disabled={columns.length <= 1}
                  className="ml-auto shrink-0 text-xs text-red-500 hover:underline disabled:opacity-30"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <button onClick={addColumn} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            <IconPlus className="h-3.5 w-3.5" aria-hidden />
            Adicionar coluna
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={create} disabled={saving || !valid} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
            {saving ? 'Criando...' : 'Criar tabela'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Modal simples pra "CREATE DATABASE" — nome só, sem opções extras (charset
 * etc.), cobre o caso comum de "quero outro banco vazio nesta instância". */
function CreateSchemaModal({ databaseId, onClose, onCreated }: { databaseId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/databases/${databaseId}/schemas`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar o banco');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Novo banco de dados" onClose={saving ? undefined : onClose} closeDisabled={saving} maxWidth="max-w-sm">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="novo_banco"
            autoFocus
            className="input font-mono text-sm"
          />
          <span className="mt-1 block text-[11px] text-slate-400">Letras, números e sublinhado, sem começar com número.</span>
        </label>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={create} disabled={saving || !name.trim()} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
            {saving ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DatabaseDataTab({
  databaseId,
  applicationId,
  serverId,
  serviceName,
  image,
}: {
  databaseId: string;
  applicationId: string;
  serverId: string;
  serviceName: string;
  image: string;
}) {
  const engine = engineOf(image);

  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [currentSchema, setCurrentSchema] = useState<string | null>(null);
  const [showCreateSchema, setShowCreateSchema] = useState(false);
  const [confirmDeleteSchema, setConfirmDeleteSchema] = useState(false);
  const [deletingSchema, setDeletingSchema] = useState(false);
  const [deleteSchemaError, setDeleteSchemaError] = useState<string | null>(null);

  const [tables, setTables] = useState<DatabaseTableInfo[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rowsResult, setRowsResult] = useState<DatabaseRowsResult | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const [showCreateTable, setShowCreateTable] = useState(false);
  const [sqlModalSeed, setSqlModalSeed] = useState<string | null>(null);
  const [rowsRefreshKey, setRowsRefreshKey] = useState(0);

  function loadSchemas() {
    apiFetch<string[]>(`/databases/${databaseId}/schemas`)
      .then((list) => {
        setSchemas(list);
        // Sem isto, `currentSchema` ficava `null` mesmo com o <select> já
        // mostrando um banco selecionado (o navegador cai no primeiro
        // <option> quando o value controlado não bate com nenhum) — o
        // estado real nunca acompanhava o que a tela mostrava, e ações que
        // dependem de "qual banco está selecionado agora" (excluir, importar)
        // ficavam presas em "nenhum banco escolhido".
        setCurrentSchema((prev) => prev ?? list[0] ?? null);
      })
      .catch(() => {});
  }

  async function deleteCurrentSchema() {
    if (!currentSchema) return;
    setDeletingSchema(true);
    setDeleteSchemaError(null);
    try {
      await apiFetch(`/databases/${databaseId}/schemas/${encodeURIComponent(currentSchema)}`, { method: 'DELETE' });
      setConfirmDeleteSchema(false);
      setCurrentSchema(null);
      loadSchemas();
    } catch (e) {
      setDeleteSchemaError(e instanceof Error ? e.message : 'Falha ao excluir o banco');
    } finally {
      setDeletingSchema(false);
    }
  }

  function loadTables() {
    const params = currentSchema ? `?database=${encodeURIComponent(currentSchema)}` : '';
    apiFetch<DatabaseTableInfo[]>(`/databases/${databaseId}/tables${params}`)
      .then((list) => {
        setTables(list);
        setTablesError(null);
      })
      .catch((e) => setTablesError(e instanceof Error ? e.message : 'Falha ao carregar tabelas'));
  }

  useEffect(() => {
    loadSchemas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  useEffect(() => {
    loadTables();
    setSelectedTable(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId, currentSchema]);

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
    if (currentSchema) params.set('database', currentSchema);
    apiFetch<DatabaseRowsResult>(`/databases/${databaseId}/tables/${encodeURIComponent(selectedTable)}/rows?${params}`)
      .then(setRowsResult)
      .catch((e) => setRowsError(e instanceof Error ? e.message : 'Falha ao carregar linhas'))
      .finally(() => setLoadingRows(false));
  }, [databaseId, selectedTable, page, search, rowsRefreshKey, currentSchema]);

  function selectTable(name: string) {
    setSelectedTable(name);
    setPage(1);
    setSearchInput('');
    setSearch('');
  }

  function openSqlEditor(seed: string) {
    setSqlModalSeed(seed);
  }

  /** Roda depois de qualquer SQL executado no editor (CREATE TABLE, INSERT,
   * UPDATE...) — a lista de tabelas e a grade da tabela aberta podem ter
   * mudado, então recarrega as duas em vez de esperar o usuário atualizar
   * a página sozinho. */
  function afterSqlRan() {
    loadTables();
    loadSchemas();
    setRowsRefreshKey((k) => k + 1);
  }

  const totalPages = rowsResult ? Math.max(1, Math.ceil(rowsResult.total / rowsResult.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <select
              value={currentSchema ?? ''}
              onChange={(e) => setCurrentSchema(e.target.value || null)}
              className="input h-8 appearance-none py-0 pl-2.5 pr-7 text-xs"
              title="Trocar de banco/schema"
            >
              {!schemas && <option value="">Carregando...</option>}
              {schemas?.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
          </div>
          <button
            onClick={() => setShowCreateSchema(true)}
            title="Novo banco de dados"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
          >
            <IconPlus className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={() => setConfirmDeleteSchema(true)}
            disabled={!currentSchema}
            title={currentSchema ? `Excluir banco "${currentSchema}"` : 'Selecione um banco'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-500/10"
          >
            <IconTrash className="h-4 w-4" aria-hidden />
          </button>
          <SqlImportButton
            applicationId={applicationId}
            serviceName={serviceName}
            image={image}
            serverId={serverId}
            database={currentSchema ?? undefined}
            label="Importar .sql"
            onDone={() => {
              loadTables();
              loadSchemas();
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {selectedTable && (
            <button
              onClick={() => openSqlEditor(insertTemplate(selectedTable, rowsResult?.columns ?? [], engine))}
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <IconPlus className="h-3.5 w-3.5" aria-hidden />
              Inserir linha
            </button>
          )}
          <button
            onClick={() => openSqlEditor('')}
            title="Editor SQL"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
          >
            <IconTerminal className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr] lg:items-stretch">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="section-label flex items-center gap-1.5">
              <IconLayers className="h-3.5 w-3.5" aria-hidden />
              Tabelas
            </p>
            <button
              onClick={() => setShowCreateTable(true)}
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
                <button onClick={() => setShowCreateTable(true)} className="btn-secondary px-3 py-1.5 text-xs">
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

      {showCreateTable && (
        <CreateTableModal
          databaseId={databaseId}
          database={currentSchema}
          engine={engine}
          onClose={() => setShowCreateTable(false)}
          onCreated={() => {
            setShowCreateTable(false);
            loadTables();
          }}
        />
      )}

      {showCreateSchema && (
        <CreateSchemaModal
          databaseId={databaseId}
          onClose={() => setShowCreateSchema(false)}
          onCreated={() => {
            setShowCreateSchema(false);
            loadSchemas();
          }}
        />
      )}

      {confirmDeleteSchema && currentSchema && (
        <ConfirmModal
          title="Excluir banco de dados"
          message={`Excluir o banco "${currentSchema}"? Todas as tabelas e dados dele são apagados — não dá pra desfazer.`}
          confirmLabel="Excluir"
          danger
          loading={deletingSchema}
          error={deleteSchemaError}
          onConfirm={deleteCurrentSchema}
          onCancel={() => {
            setConfirmDeleteSchema(false);
            setDeleteSchemaError(null);
          }}
        />
      )}

      {sqlModalSeed !== null && (
        <SqlEditorModal
          databaseId={databaseId}
          database={currentSchema}
          initialSql={sqlModalSeed}
          onClose={() => setSqlModalSeed(null)}
          onRan={afterSqlRan}
        />
      )}
    </div>
  );
}
