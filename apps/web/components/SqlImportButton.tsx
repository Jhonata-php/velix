'use client';

import { useRef, useState } from 'react';
import { getToken, clearToken } from '@/lib/api';
import { Alert } from './Alert';
import { InstallLogModal } from './InstallLogModal';
import { IconFileText } from './icons';

/** Mesmo escopo de `dbImportSecretKey` no backend — só os bancos com um dump
 * `.sql` de verdade e senha em local previsível (Mongo usa dump binário,
 * Redis não tem senha nesta fase — ver comentário no manifesto). */
export function supportsSqlImport(image: string): boolean {
  const img = image.toLowerCase();
  return ['postgres', 'mysql', 'mariadb'].some((needle) => img.includes(needle));
}

/** Sobe o arquivo via multipart pro backend (que grava em disco local) —
 * nunca lê o .sql inteiro como string no navegador. Um dump de banco real
 * fácil passa de dezenas/centenas de MB, e ler isso com FileReader +
 * mandar como um único JSON pelo WebSocket derrubava a aba ("allocation
 * size overflow"). `apiFetch` não serve aqui porque sempre força
 * Content-Type: application/json — precisa do multipart/form-data que o
 * próprio `fetch` monta sozinho a partir de um FormData. */
async function uploadSqlFile(applicationId: string, serviceName: string, file: File): Promise<string> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/applications/${applicationId}/services/${encodeURIComponent(serviceName)}/db-import/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'Falha ao enviar o arquivo');
  }
  const { uploadId } = (await res.json()) as { uploadId: string };
  return uploadId;
}

/** Botão "Importar .sql" — sobe o arquivo local via multipart e passa o
 * `uploadId` pro op `service-db-import` via InstallLogModal. Extraído de
 * `projects/[id]/services/[name]/page.tsx` pra ser reaproveitado também na
 * tela dedicada de banco de dados. Self-gating: não renderiza nada se o
 * motor da imagem não suporta import de .sql. */
export function SqlImportButton({
  applicationId,
  serviceName,
  image,
  serverId,
  database,
  label,
  onDone,
}: {
  applicationId: string;
  serviceName: string;
  image: string;
  serverId: string;
  /** Importa pra este banco/schema em vez do padrão da implantação — usado
   * pelo seletor de banco da aba Dados. */
  database?: string;
  /** Sobrescreve o texto do botão — a aba Dados já mostra qual banco está
   * selecionado ao lado, "Importar .sql" sozinho basta ali; a aba Conexão
   * (sem esse contexto) usa o texto padrão. */
  label?: string;
  onDone?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!supportsSqlImport(image)) return null;

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setUploading(true);
    try {
      const id = await uploadSqlFile(applicationId, serviceName, file);
      setUploadId(id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Falha ao enviar o arquivo');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {importError && <Alert variant="error">{importError}</Alert>}
      <input ref={fileInputRef} type="file" accept=".sql" className="hidden" onChange={handleFilePicked} />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
      >
        <IconFileText className="h-4 w-4" aria-hidden />
        {uploading ? 'Enviando arquivo...' : (label ?? 'Importar .sql')}
      </button>

      {uploadId !== null && (
        <InstallLogModal
          serverId={serverId}
          op="service-db-import"
          params={{ applicationId, serviceName, uploadId, database }}
          title={database ? `Importando .sql — ${database}` : `Importando .sql — ${serviceName}`}
          onClose={() => setUploadId(null)}
          onDone={() => onDone?.()}
        />
      )}
    </>
  );
}
