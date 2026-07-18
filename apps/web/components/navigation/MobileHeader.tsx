'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUser, type StoredUser } from '@/lib/api';
import { useUpdateStatus } from '@/lib/useUpdateStatus';
import { useEffect, useState } from 'react';
import { IconBell, IconUser } from '../icons';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  servers: 'Servidores',
  settings: 'Configurações',
  databases: 'Banco de dados',
  library: 'Biblioteca',
  updates: 'Atualizações',
};

function pageTitleFor(pathname: string | null) {
  const segment = pathname?.split('/').filter(Boolean)[0];
  return (segment && PAGE_TITLES[segment]) ?? 'Velix';
}

export function MobileHeader({ onOpenAccount }: { onOpenAccount: () => void }) {
  const pathname = usePathname();
  const updateStatus = useUpdateStatus();
  const [user, setUser] = useState<StoredUser | null>(null);
  useEffect(() => setUser(getUser()), []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/90 md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-bold text-white">
          V
        </div>
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{pageTitleFor(pathname)}</span>
      </div>

      <div className="flex items-center gap-1">
        <Link
          href="/updates"
          aria-label="Atualizações"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <IconBell className="h-[18px] w-[18px]" aria-hidden />
          {updateStatus?.updateAvailable && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
        </Link>
        <button
          onClick={onOpenAccount}
          aria-label="Conta"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {user ? (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-semibold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
          ) : (
            <IconUser className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
      </div>
    </header>
  );
}
