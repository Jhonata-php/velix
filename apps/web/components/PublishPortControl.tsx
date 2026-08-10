'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { IconPlug } from './icons';

/** Publica/troca/remove a porta do serviço direto no servidor (fora do
 * Traefik) — pra conectar um cliente de banco externo tipo DBeaver ou
 * TablePlus. Extraído de `projects/[id]/services/[name]/page.tsx` pra ser
 * reaproveitado também na tela dedicada de banco de dados. */
export function PublishPortControl({
  applicationId,
  serviceName,
  publishedPort,
  onChange,
}: {
  applicationId: string;
  serviceName: string;
  publishedPort: number | null;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [port, setPort] = useState(String(publishedPort ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(newPort: number | null) {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/applications/${applicationId}/services/${encodeURIComponent(serviceName)}/publish-port`, {
        method: 'POST',
        body: JSON.stringify({ port: newPort }),
      });
      setEditing(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao publicar a porta');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <IconPlug className="h-4 w-4 text-slate-400" aria-hidden />
          {publishedPort ? (
            <span className="text-slate-700 dark:text-slate-200">
              Porta publicada: <span className="font-mono font-medium">{publishedPort}</span>
            </span>
          ) : (
            <span className="text-slate-400">Sem porta publicada — só acessível dentro do servidor.</span>
          )}
        </div>
        {!editing && (
          <div className="flex gap-2">
            {publishedPort && (
              <button onClick={() => publish(null)} disabled={saving} className="text-xs text-red-500 hover:underline disabled:opacity-50">
                Remover
              </button>
            )}
            <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {publishedPort ? 'Trocar porta' : 'Publicar porta'}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="ex.: 3306"
            className="input h-8 w-32 py-0 text-xs"
          />
          <button
            onClick={() => publish(Number(port))}
            disabled={saving || !port.trim() || !Number.isInteger(Number(port))}
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {saving ? 'Publicando...' : 'Confirmar'}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:underline">
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-slate-400">
        Publica a porta direto no servidor (fora do Traefik) — pra conectar um cliente de banco de fora, tipo DBeaver ou
        TablePlus. Confira se a porta escolhida está liberada no firewall do servidor.
      </p>
    </div>
  );
}
