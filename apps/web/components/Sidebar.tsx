'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearToken, getUser, type StoredUser } from '@/lib/api';
import { IconDashboard, IconServer, IconSettings, IconChevronLeft, IconChevronRight, IconLogout } from './icons';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { href: '/servers', label: 'Servidores', icon: IconServer },
  { href: '/settings', label: 'Configurações', icon: IconSettings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUserState] = useState<StoredUser | null>(null);

  useEffect(() => setUserState(getUser()), []);

  return (
    <aside
      className={`flex h-screen flex-col border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-bold text-white">
              V
            </div>
            <span className="text-lg font-semibold">Velix</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          {collapsed ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon />
              {!collapsed && <span>{link.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-2 dark:border-slate-800">
        {!collapsed && user && (
          <div className="truncate px-2 py-1 text-xs text-slate-400" title={user.email}>
            {user.email}
          </div>
        )}
        <button
          onClick={() => {
            clearToken();
            router.push('/login');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <IconLogout />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
