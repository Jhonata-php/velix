'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearToken } from '@/lib/api';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/servers', label: 'Servidores', icon: '🖥️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex h-screen flex-col border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div className="flex items-center justify-between p-4">
        {!collapsed && <span className="text-lg font-semibold">Velix</span>}
        <button onClick={() => setCollapsed((v) => !v)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
              pathname?.startsWith(link.href)
                ? 'bg-slate-100 font-medium dark:bg-slate-800'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
            }`}
          >
            <span>{link.icon}</span>
            {!collapsed && <span>{link.label}</span>}
          </Link>
        ))}
      </nav>

      <button
        onClick={() => {
          clearToken();
          router.push('/login');
        }}
        className="m-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        {collapsed ? '⏻' : 'Sair'}
      </button>
    </aside>
  );
}
