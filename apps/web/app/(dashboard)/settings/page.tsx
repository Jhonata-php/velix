'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CloudflareCard } from '@/components/CloudflareCard';
import { GitAccountsCard } from '@/components/GitAccountsCard';
import { BackupCard } from '@/components/BackupCard';
import { UsersCard } from '@/components/UsersCard';
import { AlertsCard } from '@/components/AlertsCard';
import { IconShield, IconUsers, IconHardDrive, IconGithub, IconBell, IconGlobe, IconChevronRight } from '@/components/icons';

type TabKey = 'general' | 'users' | 'backup' | 'git' | 'alerts';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'general', label: 'Geral', icon: IconGlobe },
  { key: 'users', label: 'Usuários', icon: IconUsers },
  { key: 'backup', label: 'Backup', icon: IconHardDrive },
  { key: 'git', label: 'Repositórios', icon: IconGithub },
  { key: 'alerts', label: 'Alertas', icon: IconBell },
];

/**
 * Configurações em abas — antes era uma coluna só com Segurança (link),
 * Usuários, Backup, Contas de repositório, Cloudflare e Zonas empilhados, e o
 * DNS podia crescer bem além da tela. Cada seção mora na própria aba agora, e
 * cada uma continua sendo seu próprio componente (não um arquivo de 900
 * linhas com um `if` gigante).
 *
 * Segurança fica fora do conjunto de propósito: é uma página cheia (senha,
 * sessões, 2FA), não um card — e navegar pra ela em vez de embutir evita
 * misturar o histórico de navegador de duas coisas diferentes atrás do mesmo
 * botão "voltar".
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsTabs />
    </Suspense>
  );
}

function SettingsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromQuery = searchParams.get('tab') as TabKey | null;
  const [tab, setTab] = useState<TabKey>(fromQuery && TABS.some((t) => t.key === fromQuery) ? fromQuery : 'general');

  function selectTab(key: TabKey) {
    setTab(key);
    // Só pra permitir link direto (ex.: "veja em Configurações > Backup") —
    // não precisa de navegação real, então replace em vez de push.
    router.replace(`/settings?tab=${key}`, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="page-title">Configurações</h1>
        <p className="text-xs text-slate-400">Sistema e integrações</p>
      </div>

      <Link href="/settings/security" className="card card-hover mb-5 flex items-center gap-3 p-4">
        <span className="icon-chip bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <IconShield className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Segurança</span>
          <span className="block text-xs text-slate-400">Senha, sessões ativas, verificação em duas etapas</span>
        </span>
        <IconChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </Link>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'general' && <CloudflareCard />}
      {tab === 'users' && <UsersCard />}
      {tab === 'backup' && <BackupCard />}
      {tab === 'git' && <GitAccountsCard />}
      {tab === 'alerts' && <AlertsCard />}
    </div>
  );
}
