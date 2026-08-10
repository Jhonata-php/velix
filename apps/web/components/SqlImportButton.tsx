'use client';

import { useRef, useState } from 'react';
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

/** Botão "Importar .sql" — lê o arquivo local via FileReader e passa o
 * conteúdo pro op `service-db-import` via InstallLogModal. Extraído de
 * `projects/[id]/services/[name]/page.tsx` pra ser reaproveitado também na
 * tela dedicada de banco de dados. Self-gating: não renderiza nada se o
 * motor da imagem não suporta import de .sql. */
export function SqlImportButton({
  applicationId,
  serviceName,
  image,
  serverId,
  onDone,
}: {
  applicationId: string;
  serviceName: string;
  image: string;
  serverId: string;
  onDone?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!supportsSqlImport(image)) return null;

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => setImportPayload(String(reader.result ?? ''));
    reader.onerror = () => setImportError('Falha ao ler o arquivo');
    reader.readAsText(file);
  }

  return (
    <>
      {importError && <Alert variant="error">{importError}</Alert>}
      <input ref={fileInputRef} type="file" accept=".sql" className="hidden" onChange={handleFilePicked} />
      <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
        <IconFileText className="h-4 w-4" aria-hidden />
        Importar .sql
      </button>

      {importPayload !== null && (
        <InstallLogModal
          serverId={serverId}
          op="service-db-import"
          params={{ applicationId, serviceName, sqlContent: importPayload }}
          title={`Importando .sql — ${serviceName}`}
          onClose={() => setImportPayload(null)}
          onDone={() => onDone?.()}
        />
      )}
    </>
  );
}
