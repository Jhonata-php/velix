'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken, type StoredUser } from '@/lib/api';
import { BottomSheet } from './BottomSheet';
import { ThemeToggle } from '../ThemeToggle';
import { IconSettings, IconShield, IconLogout } from '../icons';

export function MoreMenuDrawer({ user, onClose }: { user: StoredUser | null; onClose: () => void }) {
  const router = useRouter();

  function logout() {
    clearToken();
    router.push('/login');
  }

  return (
    <BottomSheet title="Mais" onClose={onClose}>
      {user && (
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-semibold text-white">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
        </div>
      )}

      <div className="p-2">
        <Link
          href="/settings"
          onClick={onClose}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <IconSettings className="h-4 w-4 text-slate-400" aria-hidden />
          Configurações
        </Link>
        <Link
          href="/settings/security"
          onClick={onClose}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <IconShield className="h-4 w-4 text-slate-400" aria-hidden />
          Segurança
        </Link>

        <div className="flex items-center justify-between px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200">
          Tema
          <ThemeToggle />
        </div>

        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10"
        >
          <IconLogout className="h-4 w-4" aria-hidden />
          Sair
        </button>
      </div>
    </BottomSheet>
  );
}
