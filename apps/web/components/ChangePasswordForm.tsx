'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { PasswordInput } from './auth/PasswordInput';
import { PasswordStrength } from './auth/PasswordStrength';
import { Spinner } from './ui/Spinner';

/**
 * Miolo do formulário de trocar senha — usado tanto na página de Segurança
 * (seção fixa) quanto no modal rápido aberto pelo menu de perfil, pra não ter
 * a mesma lógica de validação/chamada de API duplicada nos dois lugares.
 */
export function ChangePasswordForm({ onSuccess }: { onSuccess?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [changing, setChanging] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (changing || mismatch) return;
    setError(null);
    setSuccess(false);
    setChanging(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setChanging(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-4">
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

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">Senha alterada com sucesso. Outras sessões foram encerradas.</Alert>}

      <button
        type="submit"
        disabled={changing || mismatch || !currentPassword || !newPassword}
        className="flex items-center gap-2 btn-primary px-4 py-2 text-sm"
      >
        {changing && <Spinner className="h-4 w-4" />}
        {changing ? 'Salvando...' : 'Alterar senha'}
      </button>
    </form>
  );
}
