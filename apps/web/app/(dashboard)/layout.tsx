'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <header className="flex items-center justify-end border-b border-slate-200 p-4 dark:border-slate-800">
          <ThemeToggle />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
