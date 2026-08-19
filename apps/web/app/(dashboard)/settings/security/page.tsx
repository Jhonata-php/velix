'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import { parseUserAgent } from '@/lib/parseUserAgent';
import { Alert } from '@/components/Alert';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { Spinner } from '@/components/ui/Spinner';
import { IconDevice, IconShield, IconLock } from '@/components/icons';
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

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [changing, setChanging] = useState(false);

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

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (changing || mismatch) return;
    setChangeError(null);
    setChangeSuccess(false);
    setChanging(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setChangeSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      loadSessions();
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setChanging(false);
    }
  }

  const current = sessions?.find((s) => s.current);
  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Segurança</h1>
        <p className="text-xs text-slate-400">Senha, sessões ativas e atividade da conta</p>
      </div>

      <section className="card p-3.5">
        <h2 className="section-title mb-3">Alterar senha</h2>
        <form onSubmit={handleChangePassword} className="max-w-sm space-y-4">
          <PasswordInput label="Senha atual" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <div>
            <PasswordInput label="Nova senha" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            <PasswordStrength password={newPassword} />
          </div>
          <PasswordInput
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            invalid={mismatch}
            errorMessage="As senhas não coincidem."
          />

          {changeError && <Alert variant="error">{changeError}</Alert>}
          {changeSuccess && <Alert variant="success">Senha alterada com sucesso. Outras sessões foram encerradas.</Alert>}

          <button
            type="submit"
            disabled={changing || mismatch || !currentPassword || !newPassword}
            className="flex items-center gap-2 btn-primary px-4 py-2 text-sm"
          >
            {changing && <Spinner className="h-4 w-4" />}
            {changing ? 'Salvando...' : 'Alterar senha'}
          </button>
        </form>
      </section>

      <section className="card p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Sessões ativas</h2>
          {others.length > 0 && (
            <button onClick={handleRevokeOthers} disabled={revokingOthers} className="btn-secondary px-3 py-1.5 text-xs">
              {revokingOthers ? 'Encerrando...' : 'Encerrar todas as outras sessões'}
            </button>
          )}
        </div>

        {sessionsError && <Alert variant="error">{sessionsError}</Alert>}

        {!sessions ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : (
          <div className="space-y-2">
            {current && (
              <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-900/10">
                <div className="flex items-center gap-2.5">
                  <IconDevice className="h-4 w-4 shrink-0 text-indigo-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {parseUserAgent(current.userAgent)} <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400">· este dispositivo</span>
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
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
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

            {others.length === 0 && current && <p className="text-xs text-slate-400">Nenhuma outra sessão ativa.</p>}
          </div>
        )}
      </section>

      <TwoFactorCard />

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <IconLock className="h-3.5 w-3.5" />
        Alterar a senha ou encerrar sessões nunca é registrado com a senha em si — apenas o evento.
      </p>
    </div>
  );
}
