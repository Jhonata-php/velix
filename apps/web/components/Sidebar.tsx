'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearToken, getUser, type StoredUser } from '@/lib/api';
import { useUpdateStatus } from '@/lib/useUpdateStatus';
import {
  IconDashboard,
  IconServer,
  IconSettings,
  IconLogout,
  IconStore,
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
} from './icons';

const GROUPS = [
  {
    title: 'Visão geral',
    items: [{ href: '/dashboard', label: 'Dashboard', description: 'Visão geral da infraestrutura', icon: IconDashboard }],
  },
  {
    title: 'Infraestrutura',
    items: [
      { href: '/servers', label: 'Servidores', description: 'Cadastro e monitoramento', icon: IconServer },
      { href: '/library', label: 'Aplicações', description: 'Catálogo e implantação', icon: IconStore },
    ],
  },
  {
    title: 'Automação',
    items: [{ href: '/updates', label: 'Atualizações', description: 'Versão instalada e releases', icon: IconDownload }],
  },
  {
    title: 'Sistema',
    items: [{ href: '/settings', label: 'Configurações', description: 'Sistema e integrações', icon: IconSettings }],
  },
] as const;

const COLLAPSE_KEY = 'velix_sidebar_collapsed';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useLoggedUser();
  const logout = useLogout();
  const updateStatus = useUpdateStatus();
  const updateAvailable = !!updateStatus?.updateAvailable;

  // O Sidebar só monta depois que o DashboardLayout confirma a sessão (client-side,
  // pós-hidratação) — ler localStorage direto no inicializador não causa flash
  // nem mismatch de hidratação, porque este componente nunca participa do SSR.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === 'true');

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 [transform:translateZ(0)] flex-col border-r border-slate-200 bg-white py-4 transition-[width] duration-150 dark:border-slate-700 dark:bg-slate-950 md:flex ${
        collapsed ? 'w-[72px] items-center' : 'w-60'
      }`}
    >
      <div className={`mb-5 flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-4'}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold text-white shadow-md shadow-indigo-500/30">
          V
        </div>
        {!collapsed && <span className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">Velix</span>}
      </div>

      <nav className={`flex flex-1 flex-col gap-4 overflow-y-auto ${collapsed ? 'items-center px-2' : 'px-3'}`}>
        {GROUPS.map((group) => (
          <div key={group.title} className={collapsed ? '' : 'w-full'}>
            {!collapsed && <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>}
            <div className={collapsed ? 'flex flex-col items-center gap-1.5' : 'space-y-0.5'}>
              {group.items.map((link) => {
                const active = pathname?.startsWith(link.href);
                const Icon = link.icon;
                const badge = link.href === '/updates' && updateAvailable;

                if (collapsed) {
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${
                        active ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      {active && <span className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-indigo-500" />}
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                      {badge && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      {/* Tooltip só no modo recolhido — no expandido o label já está visível. */}
                      <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 w-52 -translate-y-1/2 translate-x-1 rounded-lg border border-slate-200 bg-white p-3 opacity-0 shadow-lg transition group-hover:translate-x-0 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800">
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{link.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{link.description}</span>
                      </span>
                    </Link>
                  );
                }

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                      active
                        ? 'bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{link.label}</span>
                    {badge && <span aria-hidden className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
        className={`mb-3 flex h-9 items-center gap-2 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-300 ${
          collapsed ? 'w-9 justify-center' : 'w-full px-2.5'
        }`}
      >
        {collapsed ? <IconChevronRight className="h-4 w-4" aria-hidden /> : <IconChevronLeft className="h-4 w-4" aria-hidden />}
        {!collapsed && <span className="text-xs font-medium">Recolher</span>}
      </button>

      {user && (
        <div ref={menuRef} className={`relative ${collapsed ? '' : 'w-full px-3'}`}>
          {menuOpen && (
            <div
              className={`absolute z-30 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
                collapsed ? 'bottom-0 left-full ml-3' : 'bottom-full left-3 mb-2'
              }`}
            >
              <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
              </div>
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <IconLogout className="h-4 w-4" aria-hidden />
                Sair
              </button>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title={user.name}
            className={`flex items-center gap-2.5 rounded-lg transition hover:bg-slate-100 dark:hover:bg-slate-800/60 ${collapsed ? 'p-0' : 'w-full px-2 py-1.5'}`}
          >
            <Avatar user={user} />
            {!collapsed && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{user.name}</span>
                <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
              </span>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
