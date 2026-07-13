'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearToken, getUser, type StoredUser } from '@/lib/api';
import {
  IconDashboard,
  IconServer,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconLogout,
} from './icons';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', description: 'Visão geral da infraestrutura', icon: IconDashboard },
  { href: '/servers', label: 'Servidores', description: 'Cadastro e monitoramento', icon: IconServer },
  { href: '/settings', label: 'Configurações', description: 'Sistema e integrações', icon: IconSettings },
];

function roleLabel(role: string) {
  if (role === 'admin') return 'Administrador';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function useLoggedUser() {
  const [user, setUserState] = useState<StoredUser | null>(null);
  useEffect(() => setUserState(getUser()), []);
  return user;
}

function useLogout() {
  const router = useRouter();
  return () => {
    clearToken();
    router.push('/login');
  };
}

function Avatar({ user }: { user: StoredUser }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-semibold text-white">
      {user.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useLoggedUser();
  const logout = useLogout();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <>
      {/* Desktop: sidebar lateral recolhível */}
      <aside
        className={`relative hidden h-screen flex-col border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-slate-900 md:flex ${
          collapsed ? 'w-20' : 'w-72'
        }`}
      >
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:hover:text-indigo-400"
        >
          {collapsed ? <IconChevronRight className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
        </button>

        <div className={`flex items-center gap-2 p-5 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold text-white shadow-md shadow-indigo-500/30">
            V
          </div>
          {!collapsed && <span className="text-xl font-semibold">Velix</span>}
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                title={collapsed ? link.label : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {!collapsed && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{link.label}</span>
                    <span className={`block truncate text-xs ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{link.description}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div ref={menuRef} className="relative border-t border-slate-100 p-3 dark:border-slate-800">
            {menuOpen && !collapsed && (
              <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <IconLogout className="h-4 w-4" />
                  Sair
                </button>
              </div>
            )}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ${collapsed ? 'justify-center' : ''}`}
            >
              <Avatar user={user} />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{user.name}</span>
                    <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
                  </span>
                  <IconChevronUp className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${menuOpen ? '' : 'rotate-180'}`} />
                </>
              )}
            </button>
          </div>
        )}
      </aside>

      {/* Mobile: barra de navegação fixa embaixo */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:hidden">
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              {link.label}
            </Link>
          );
        })}
        <button onClick={logout} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          <IconLogout className="h-5 w-5" />
          Sair
        </button>
      </nav>
    </>
  );
}
