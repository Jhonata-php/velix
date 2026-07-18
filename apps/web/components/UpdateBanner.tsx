'use client';

import Link from 'next/link';
import { useUpdateStatus } from '@/lib/useUpdateStatus';
import { IconDownload } from './icons';

export function UpdateBanner() {
  const status = useUpdateStatus();
  if (!status?.updateAvailable || !status.release) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-indigo-900 dark:bg-indigo-900/20">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
          <IconDownload className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            Nova atualização disponível — Velix v{status.release.version}
          </p>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70">
            Você está usando v{status.installedVersion}. Veja o que mudou antes de decidir atualizar.
          </p>
        </div>
      </div>
      <Link href="/updates" className="btn-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
        Ver detalhes
      </Link>
    </div>
  );
}
