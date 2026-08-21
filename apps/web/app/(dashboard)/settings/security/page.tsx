'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import { parseUserAgent } from '@/lib/parseUserAgent';
import { Alert } from '@/components/Alert';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { rowStatusBorderClass } from '@/components/StatusBadge';
import { IconDevice, IconLock } from '@/components/icons';
import { TwoFactorCard } from '@/components/TwoFactorCard';

interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export default function SecurityPage() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  function loadSessions() {
    apiFetch<SessionInfo[]>('/auth/sessions')
      .then((rows) => {
        setSessions(rows);
        setSessionsError(null);
      })
      .catch((err) => setSessionsError(err instanceof Error ? err.message : 'Não foi possível carregar as sessões.'));
  }

  useEffect(loadSessions, []);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
      loadSessions();
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    try {
      await apiFetch('/auth/sessions/revoke-others', { method: 'POST' });
      loadSessions();
    } finally {
      setRevokingOthers(false);
    }
  }

  const current = sessions?.find((s) => s.current);
  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Segurança</h1>
        <p className="text-xs text-slate-400">Senha, sessões ativas e atividade da conta</p>
      </div>

      <TwoFactorCard />

      <section className="card p-3.5">
        <h2 className="section-title mb-3">Alterar senha</h2>
        <ChangePasswordForm onSuccess={loadSessions} />
      </section>

      <section className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-3 dark:border-slate-700">
          <h2 className="section-title">Sessões ativas</h2>
          {others.length > 0 && (
            <button onClick={handleRevokeOthers} disabled={revokingOthers} className="btn-secondary px-3 py-1.5 text-xs">
              {revokingOthers ? 'Encerrando...' : 'Encerrar todas as outras sessões'}
            </button>
          )}
        </div>

        {sessionsError && (
          <div className="p-3.5">
            <Alert variant="error">{sessionsError}</Alert>
          </div>
        )}

        {!sessions ? (
          <p className="p-3.5 text-sm text-slate-400">Carregando...</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {current && (
              <div className={`flex items-center justify-between gap-3 border-l-[3px] ${rowStatusBorderClass('success')} px-3.5 py-3`}>
                <div className="flex items-center gap-2.5">
                  <IconDevice className="h-4 w-4 shrink-0 text-green-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {parseUserAgent(current.userAgent)} <span className="text-xs font-normal text-green-600 dark:text-green-400">· este dispositivo</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      <span className="font-mono">{current.ip}</span> · último login {relativeTime(current.createdAt)} · atividade{' '}
                      {relativeTime(current.lastSeenAt)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {others.map((s) => (
              <div key={s.id} className={`flex items-center justify-between gap-3 border-l-[3px] ${rowStatusBorderClass('neutral')} px-3.5 py-3`}>
                <div className="flex items-center gap-2.5">
                  <IconDevice className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{parseUserAgent(s.userAgent)}</p>
                    <p className="text-xs text-slate-400">
                      <span className="font-mono">{s.ip}</span> · login {relativeTime(s.createdAt)} · atividade {relativeTime(s.lastSeenAt)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  {revokingId === s.id ? 'Encerrando...' : 'Encerrar'}
                </button>
              </div>
            ))}

            {others.length === 0 && current && <p className="p-3.5 text-xs text-slate-400">Nenhuma outra sessão ativa.</p>}
          </div>
        )}
      </section>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <IconLock className="h-3.5 w-3.5" />
        Alterar a senha ou encerrar sessões nunca é registrado com a senha em si — apenas o evento.
      </p>
    </div>
  );
}
