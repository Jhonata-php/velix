'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { CatalogApplicationDetail, ServerSummary } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/catalogCategories';
import { AppIcon } from './AppIcon';
import { Alert } from './Alert';
import { StatusBadge } from './StatusBadge';
import { OpsLogPanel, type OpsLogStatus } from './InstallLogModal';
import { TerminalWindow } from './TerminalChrome';
import { IconCheck, IconX, IconServer, IconGlobe, IconTerminal, IconKey, IconCopy, IconEye, IconEyeOff, IconRefresh } from './icons';
import { NetworkPulse } from './NetworkPulse';
import { DeployProgress, type ProgressStage } from './DeployProgress';

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Rótulo curto e legível pra sugestão de domínio aleatório — não precisa ser
 * criptograficamente forte, só improvável de colidir com outro subdomínio já
 * usado na mesma zona. */
function randomDomainLabel(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'app'}-${Math.random().toString(36).slice(2, 6)}`;
}

const ENVIRONMENTS: { value: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'LAB'; label: string }[] = [
  { value: 'PRODUCTION', label: 'Produção' },
  { value: 'STAGING', label: 'Homologação' },
  { value: 'DEVELOPMENT', label: 'Desenvolvimento' },
  { value: 'LAB', label: 'Laboratório' },
];

type StepKey = 'info' | 'server' | 'components' | 'variables' | 'storage' | 'domain' | 'review' | 'deploy';

const ALL_STEPS: { key: StepKey; label: string }[] = [
  { key: 'info', label: 'Informações' },
  { key: 'server', label: 'Servidor' },
  { key: 'components', label: 'Componentes' },
  { key: 'variables', label: 'Variáveis' },
  { key: 'storage', label: 'Armazenamento' },
  { key: 'domain', label: 'Domínio' },
  { key: 'review', label: 'Revisão' },
  { key: 'deploy', label: 'Implantação' },
];

/** Obrigatórios + opcionais escolhidos, com dependências resolvidas em cascata —
 * espelha `resolveIncludedServices` do backend (catalog.util.ts) pra mostrar no
 * assistente exatamente o que vai entrar no compose. */
function resolveIncludedServiceNames(manifest: CatalogApplicationDetail, selectedOptional: string[]): Set<string> {
  const byName = new Map(manifest.services.map((s) => [s.name, s]));
  const included = new Set(manifest.services.filter((s) => !s.optional).map((s) => s.name));
  for (const name of selectedOptional) if (byName.has(name)) included.add(name);

  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Array.from(included)) {
      for (const dep of byName.get(name)?.dependsOn ?? []) {
        if (!included.has(dep)) {
          included.add(dep);
          changed = true;
        }
      }
    }
  }
  return included;
}

interface Props {
  manifest: CatalogApplicationDetail;
  preselectedServerId?: string;
  /** Quando informado, o serviço entra NESTE projeto já existente — pula as
   * etapas "Informações" (nome/ambiente/tags já são do projeto) e "Servidor"
   * (já é o servidor do projeto, fixo). Sem isso, o assistente cria um projeto
   * novo automaticamente com os dados da etapa "Informações". */
  applicationId?: string;
  projectServerId?: string;
  onClose: () => void;
}

export function DeployWizard({ manifest, preselectedServerId, applicationId, projectServerId, onClose }: Props) {
  const router = useRouter();
  const visibleSteps = useMemo(
    () => (applicationId ? ALL_STEPS.filter((s) => s.key !== 'info' && s.key !== 'server') : ALL_STEPS),
    [applicationId],
  );
  const [step, setStep] = useState(0);
  const currentKey = visibleSteps[step]?.key;

  // Trilha de etapas: barra de rolagem escondida, arraste horizontal no lugar.
  const stepsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; left: number } | null>(null);

  // 1. Informações
  const [name, setName] = useState(manifest.name);
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<(typeof ENVIRONMENTS)[number]['value']>('PRODUCTION');
  const [tagsInput, setTagsInput] = useState('');

  // 2. Servidor — fixo (o do projeto) quando `applicationId` é passado.
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [serverId, setServerId] = useState(projectServerId ?? preselectedServerId ?? '');

  function reloadServers() {
    apiFetch<ServerSummary[]>('/servers').then(setServers);
  }

  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    apiFetch<ServerSummary[]>('/servers').then((list) => {
      setServers(list);
      if (!preselectedServerId && !projectServerId) {
        const recommended = list.find((s) => s.status === 'ONLINE' && s.dockerInstalled);
        if (recommended) setServerId(recommended.id);
      }
    });
    // Sem conta Cloudflare conectada, a API devolve 404 — sem problema, só
    // significa que o botão de gerar domínio aleatório fica escondido.
    apiFetch<{ id: string; name: string }[]>('/cloudflare/zones')
      .then(setZones)
      .catch(() => {});
  }, [preselectedServerId, projectServerId]);

  const selectedServer = servers?.find((s) => s.id === serverId) ?? null;

  // 3. Componentes
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const includedServiceNames = useMemo(() => resolveIncludedServiceNames(manifest, selectedServices), [manifest, selectedServices]);
  const includedServices = useMemo(() => manifest.services.filter((s) => includedServiceNames.has(s.name)), [manifest, includedServiceNames]);

  // 4. Variáveis
  const allVariables = useMemo(() => includedServices.flatMap((s) => s.variables), [includedServices]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  useEffect(() => {
    setVariables((prev) => ({ ...Object.fromEntries(allVariables.map((v) => [v.key, v.default ?? ''])), ...prev }));
  }, [allVariables]);

  // 6. Domínio
  const [wantsDomain, setWantsDomain] = useState(false);
  const [hostname, setHostname] = useState('');
  const [createDnsRecord, setCreateDnsRecord] = useState(true);

  // 8. Implantação
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    applicationId?: string;
    deploymentId?: string;
    domain?: { hostname: string } | null;
  } | null>(null);

  const allVolumes = includedServices.flatMap((s) => s.volumes.map((v) => ({ ...v, service: s.name })));
  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const validByKey: Record<StepKey, boolean> = {
    info: name.trim().length >= 2,
    server: !!selectedServer && selectedServer.dockerInstalled,
    components: true,
    variables: allVariables.every((v) => !v.required || (variables[v.key] ?? '').trim().length > 0),
    storage: true,
    domain: !wantsDomain || HOSTNAME_PATTERN.test(hostname.trim()),
    review: true,
    deploy: true,
  };
  const stepValid: boolean[] = visibleSteps.map((s) => validByKey[s.key]);

  function goNext() {
    if (!stepValid[step]) return;
    if (currentKey === 'review') {
      setStep((s) => s + 1);
      setDeploying(true);
      return;
    }
    setStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  const serviceParams = {
    manifestSlug: manifest.slug,
    variables,
    selectedServices,
    ...(wantsDomain ? { domain: { hostname: hostname.trim(), createDnsRecord } } : {}),
  };
  const projectInfo = {
    serverId,
    name: name.trim(),
    description: description.trim() || undefined,
    environment,
    tags,
  };

  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md">
      <div className="modal-pop card flex max-h-[85vh] min-h-[480px] w-full max-w-4xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <AppIcon icon={manifest.icon} name={manifest.name} size="sm" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Implantar {manifest.name}</h2>
              <p className="text-xs text-slate-400">Etapa {step + 1} de {visibleSteps.length} — {visibleSteps[step]?.label}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={deploying && !result} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={stepsRef}
          onPointerDown={(e) => {
            const el = stepsRef.current;
            if (!el) return;
            dragRef.current = { x: e.clientX, left: el.scrollLeft };
            el.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag || !stepsRef.current) return;
            stepsRef.current.scrollLeft = drag.left - (e.clientX - drag.x);
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          className="no-scrollbar flex cursor-grab select-none items-center gap-1 overflow-x-auto border-b border-slate-200 px-5 py-2.5 active:cursor-grabbing dark:border-slate-700"
        >
          {visibleSteps.map(({ key, label }, i) => (
            <div key={key} className="flex items-center gap-1">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  i < step
                    ? 'bg-indigo-500 text-white'
                    : i === step
                      ? 'border-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                }`}
              >
                {i < step ? <IconCheck className="h-3 w-3" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-xs ${i === step ? 'font-medium text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{label}</span>
              {i < visibleSteps.length - 1 && <span className="mx-1.5 h-px w-4 bg-slate-200 dark:bg-slate-700" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {currentKey === 'info' && (
            <InformationsStep
              manifest={manifest}
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              environment={environment}
              setEnvironment={setEnvironment}
              tagsInput={tagsInput}
              setTagsInput={setTagsInput}
            />
          )}
          {currentKey === 'server' && <ServerStep servers={servers} serverId={serverId} setServerId={setServerId} />}
          {currentKey === 'components' && (
            <ComponentsStep
              manifest={manifest}
              selectedServices={selectedServices}
              setSelectedServices={setSelectedServices}
              includedServiceNames={includedServiceNames}
            />
          )}
          {currentKey === 'variables' && (
            <VariablesStep allVariables={allVariables} variables={variables} setVariables={setVariables} secretKeys={manifest.secretKeys} />
          )}
          {currentKey === 'storage' && <StorageStep volumes={allVolumes} />}
          {currentKey === 'domain' && (
            <DomainStep
              manifest={manifest}
              wantsDomain={wantsDomain}
              setWantsDomain={setWantsDomain}
              hostname={hostname}
              setHostname={setHostname}
              createDnsRecord={createDnsRecord}
              setCreateDnsRecord={setCreateDnsRecord}
              traefikInstalled={!!selectedServer?.traefikInstalled}
              serverId={selectedServer?.id ?? ''}
              onTraefikInstalled={reloadServers}
              zones={zones}
            />
          )}
          {currentKey === 'review' && (
            <ReviewStep
              manifest={manifest}
              applicationId={applicationId}
              name={name}
              description={description}
              environment={environment}
              tags={tags}
              server={selectedServer}
              variables={variables}
              allVariables={allVariables}
              volumes={allVolumes}
              includedServices={includedServices}
              wantsDomain={wantsDomain}
              hostname={hostname}
            />
          )}
          {currentKey === 'deploy' && serverId && (
            <DeployStep
              applicationId={applicationId}
              serverId={serverId}
              serviceParams={serviceParams}
              projectInfo={projectInfo}
              onResult={setResult}
              appName={name.trim() || manifest.name}
            />
          )}
        </div>

        {currentKey !== 'deploy' && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800"
            >
              Voltar
            </button>
            <button onClick={goNext} disabled={!stepValid[step]} className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
              {currentKey === 'review' ? 'Implantar' : 'Próximo'}
            </button>
          </div>
        )}

        {currentKey === 'deploy' && result && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Fechar
            </button>
            {result.ok && result.applicationId && (
              <button onClick={() => router.push(`/projects/${result.applicationId}`)} className="btn-primary px-4 py-2 text-sm">
                Ver projeto
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InformationsStep({
  manifest,
  name,
  setName,
  description,
  setDescription,
  environment,
  setEnvironment,
  tagsInput,
  setTagsInput,
}: {
  manifest: CatalogApplicationDetail;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  environment: string;
  setEnvironment: (v: (typeof ENVIRONMENTS)[number]['value']) => void;
  tagsInput: string;
  setTagsInput: (v: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card flex items-center gap-4 p-4">
        <AppIcon icon={manifest.icon} name={manifest.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{manifest.name}</p>
          <p className="line-clamp-2 text-xs text-slate-500">{manifest.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="badge bg-slate-500/10 text-[10px] text-slate-600 dark:text-slate-300">{CATEGORY_LABEL[manifest.category] ?? manifest.category}</span>
          <span className="text-[11px] text-slate-400">v{manifest.version}</span>
        </div>
      </div>
      <div className="card space-y-5 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome do projeto</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Ambiente</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as (typeof ENVIRONMENTS)[number]['value'])} className="input">
              {ENVIRONMENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Descrição (opcional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input resize-none" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Tags (separadas por vírgula, opcional)</span>
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="ex.: monitoramento, interno" className="input" />
        </label>
      </div>
    </div>
  );
}

function ServerStep({
  servers,
  serverId,
  setServerId,
}: {
  servers: ServerSummary[] | null;
  serverId: string;
  setServerId: (id: string) => void;
}) {
  if (servers === null) return <p className="text-sm text-slate-400">Carregando servidores...</p>;
  if (servers.length === 0) return <p className="text-sm text-slate-400">Nenhum servidor cadastrado — adicione um servidor primeiro.</p>;

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {servers.map((s) => {
        const compatible = s.dockerInstalled;
        const selected = s.id === serverId;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!compatible}
            onClick={() => setServerId(s.id)}
            className={`card flex flex-col gap-1.5 p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? 'border-indigo-400 ring-2 ring-indigo-500/20' : 'hover:border-indigo-400/50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <IconServer className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
              </div>
              <StatusBadge tone={s.status === 'ONLINE' ? 'success' : s.status === 'ERROR' ? 'danger' : 'neutral'}>{s.status}</StatusBadge>
            </div>
            <p className="truncate text-xs text-slate-400">{s.publicIp ?? s.privateIp ?? '—'} · {s.osName ?? 'SO desconhecido'}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className={`badge text-[10px] ${s.dockerInstalled ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-slate-500/10 text-slate-500'}`}>
                {s.dockerInstalled ? 'Docker instalado' : 'Docker ausente'}
              </span>
              <span className={`badge text-[10px] ${s.traefikInstalled ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-slate-500/10 text-slate-500'}`}>
                {s.traefikInstalled ? 'Traefik instalado' : 'Sem Traefik'}
              </span>
            </div>
            {s.metrics && (
              <p className="text-[11px] text-slate-400">
                {s.metrics.memUsedMb != null && s.metrics.memTotalMb != null ? `${s.metrics.memUsedMb}/${s.metrics.memTotalMb} MB RAM` : ''}
                {s.metrics.diskPercent ? ` · ${s.metrics.diskPercent} disco` : ''}
              </p>
            )}
            {!compatible && <p className="text-[11px] text-red-500">Instale o Docker neste servidor pra usá-lo.</p>}
          </button>
        );
      })}
    </div>
  );
}

function ComponentsStep({
  manifest,
  selectedServices,
  setSelectedServices,
  includedServiceNames,
}: {
  manifest: CatalogApplicationDetail;
  selectedServices: string[];
  setSelectedServices: (fn: (v: string[]) => string[]) => void;
  includedServiceNames: Set<string>;
}) {
  const required = manifest.services.filter((s) => !s.optional);
  const optional = manifest.services.filter((s) => s.optional);

  function toggle(name: string) {
    setSelectedServices((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="section-label mb-2">Obrigatórios</p>
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {required.map((s) => (
            <div key={s.name} className="flex items-center gap-3 p-3.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-indigo-500 bg-indigo-500 text-white">
                <IconCheck className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                <p className="truncate text-xs text-slate-400">{s.image}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {optional.length > 0 && (
        <div>
          <p className="section-label mb-2">Opcionais</p>
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            {optional.map((s) => {
              const checked = selectedServices.includes(s.name);
              const autoIncluded = includedServiceNames.has(s.name) && !checked;
              return (
                <label key={s.name} className="flex cursor-pointer items-center gap-3 p-3.5">
                  <input
                    type="checkbox"
                    checked={checked || autoIncluded}
                    disabled={autoIncluded}
                    onChange={() => toggle(s.name)}
                    className="h-4 w-4 shrink-0 accent-indigo-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {s.image}
                      {autoIncluded ? ' · incluído automaticamente (dependência)' : ''}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function VariablesStep({
  allVariables,
  variables,
  setVariables,
  secretKeys,
}: {
  allVariables: CatalogApplicationDetail['services'][number]['variables'];
  variables: Record<string, string>;
  setVariables: (fn: (v: Record<string, string>) => Record<string, string>) => void;
  secretKeys: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {allVariables.length === 0 ? (
        <p className="text-sm text-slate-400">Esta aplicação não possui variáveis configuráveis.</p>
      ) : (
        <div className="card space-y-5 p-5">
          {allVariables.map((v) => (
            <label key={v.key} className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">
                {v.label} {v.required && <span className="text-red-500">*</span>}
              </span>
              {v.description && <span className="mb-1.5 block text-xs text-slate-400">{v.description}</span>}
              {v.type === 'boolean' ? (
                <select
                  value={variables[v.key] ?? ''}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                  className="input"
                >
                  {(v.options ?? ['true', 'false']).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : v.type === 'select' && v.options ? (
                <select
                  value={variables[v.key] ?? ''}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                  className="input"
                >
                  {v.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={v.type === 'password' ? 'password' : v.type === 'number' ? 'number' : 'text'}
                  value={variables[v.key] ?? ''}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                  className="input"
                />
              )}
            </label>
          ))}
        </div>
      )}

      {secretKeys.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          {secretKeys.length} segredo{secretKeys.length === 1 ? '' : 's'} ({secretKeys.join(', ')}) ser{secretKeys.length === 1 ? 'á' : 'ão'} gerado
          {secretKeys.length === 1 ? '' : 's'} automaticamente com valor aleatório — disponível em &quot;Ver credenciais&quot; depois do deploy.
        </div>
      )}
    </div>
  );
}

function StorageStep({ volumes }: { volumes: { name: string; containerPath: string; service: string }[] }) {
  if (volumes.length === 0) return <p className="text-sm text-slate-400">Esta aplicação não usa armazenamento persistente.</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <p className="text-xs text-slate-400">O Velix cria e gerencia um volume Docker nomeado pra cada item abaixo — persistente entre reinicializações e atualizações.</p>
      <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
        {volumes.map((v) => (
          <div key={`${v.service}-${v.name}`} className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{v.name}</p>
              <p className="text-xs text-slate-400">serviço {v.service}</p>
            </div>
            <span className="font-mono text-xs text-slate-500">{v.containerPath}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACME_INVALID_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example', 'internal', 'lan', 'home', 'arpa']);

/** Mesma validação da aba Proxy: o Let's Encrypt rejeita e-mail de TLD reservado,
 * e o erro só aparece muito depois, na emissão do certificado. */
function isValidAcmeEmailClient(email: string) {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  return !ACME_INVALID_TLDS.has(trimmed.split('.').pop() ?? '');
}

function DomainStep({
  manifest,
  wantsDomain,
  setWantsDomain,
  hostname,
  setHostname,
  createDnsRecord,
  setCreateDnsRecord,
  traefikInstalled,
  serverId,
  onTraefikInstalled,
  zones,
}: {
  manifest: CatalogApplicationDetail;
  wantsDomain: boolean;
  setWantsDomain: (v: boolean) => void;
  hostname: string;
  setHostname: (v: string) => void;
  createDnsRecord: boolean;
  setCreateDnsRecord: (v: boolean) => void;
  traefikInstalled: boolean;
  serverId: string;
  onTraefikInstalled: () => void;
  zones: { id: string; name: string }[];
}) {
  const [acmeEmail, setAcmeEmail] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<OpsLogStatus>('connecting');
  const [showInstallLog, setShowInstallLog] = useState(false);

  const emailValid = isValidAcmeEmailClient(acmeEmail);
  const installDone = installStatus === 'done-ok';

  // Instalar sem sair do assistente: mandar o usuário pra outra tela no meio de
  // um fluxo de 8 etapas significa perder tudo que ele já preencheu.
  if (!traefikInstalled && !installDone) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card space-y-4 p-5">
          {!installing ? (
            <>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                  <IconGlobe className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Publicar com domínio precisa do Traefik</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Ele é o proxy reverso que recebe o domínio e emite o certificado HTTPS. Ocupa as portas 80 e 443 do servidor e
                    cria a rede <code>velix-proxy</code>. Dá pra instalar agora, sem sair daqui.
                  </p>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">E-mail de contato (Let&apos;s Encrypt)</span>
                <input
                  type="email"
                  placeholder="voce@seudominio.com"
                  value={acmeEmail}
                  onChange={(e) => setAcmeEmail(e.target.value)}
                  className="input"
                />
                <span className="mt-1 block text-[11px] text-slate-400">
                  Só pra avisos de expiração de certificado. Precisa de um domínio público real — endereços como
                  admin@velix.local são recusados pelo Let&apos;s Encrypt.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setInstalling(true)} disabled={!emailValid} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  Instalar Traefik agora
                </button>
                <button onClick={() => setWantsDomain(false)} className="btn-secondary px-4 py-2 text-sm">
                  Seguir sem domínio
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-4 text-center">
              <NetworkPulse
                state={installStatus === 'done-error' ? 'error' : 'running'}
                label="T"
                className="h-28 w-28"
                ariaLabel="Instalando Traefik"
              />
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">
                {installStatus === 'done-error' ? 'Falha ao instalar o Traefik' : 'Instalando o Traefik'}
              </h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                {installStatus === 'done-error'
                  ? 'Veja o log abaixo. Você pode seguir sem domínio e publicar depois.'
                  : 'Baixando a imagem, criando a rede e subindo o proxy no servidor.'}
              </p>

              <button
                onClick={() => setShowInstallLog((v) => !v)}
                className="mt-4 flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                <IconTerminal className="h-3.5 w-3.5" aria-hidden />
                {showInstallLog ? 'Ocultar log' : 'Ver log'}
              </button>

              {installStatus === 'done-error' && (
                <button onClick={() => setWantsDomain(false)} className="btn-secondary mt-3 px-4 py-2 text-sm">
                  Seguir sem domínio
                </button>
              )}

              <div className={`mt-3 w-full ${showInstallLog ? '' : 'sr-only'}`}>
                <TerminalWindow title="Instalação do Traefik" bodyClassName="flex h-[30vh] p-3">
                  <OpsLogPanel
                    serverId={serverId}
                    op="traefik-install"
                    params={{ acmeEmail: acmeEmail.trim() }}
                    onStatusChange={setInstallStatus}
                    onDone={(ok) => {
                      if (ok) onTraefikInstalled();
                    }}
                  />
                </TerminalWindow>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card space-y-4 p-5">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={wantsDomain} onChange={(e) => setWantsDomain(e.target.checked)} />
          <span className="font-medium text-slate-700 dark:text-slate-200">Publicar com domínio e HTTPS automático</span>
        </label>
        {installDone && !traefikInstalled && (
          <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <IconCheck className="h-3.5 w-3.5" aria-hidden /> Traefik instalado neste servidor.
          </p>
        )}

        {wantsDomain && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
              <IconGlobe className="h-4 w-4 shrink-0 text-indigo-500" />
              Detectado automaticamente: serviço <span className="font-medium text-slate-700 dark:text-slate-200">{manifest.primaryService}</span>, porta{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">{manifest.primaryPort}</span>. Pra apontar pra outro serviço/porta, edite o
              domínio depois do deploy.
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Domínio</span>
              <div className="flex gap-2">
                <input required placeholder="app.seudominio.com" value={hostname} onChange={(e) => setHostname(e.target.value)} className="input" />
                {zones.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setHostname(`${randomDomainLabel(manifest.slug)}.${zones[0].name}`)}
                    title={`Gerar domínio aleatório em ${zones[0].name}`}
                    className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 text-sm"
                  >
                    <IconRefresh className="h-4 w-4" aria-hidden />
                    Aleatório
                  </button>
                )}
              </div>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
              Criar registro DNS na Cloudflare automaticamente
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  manifest,
  applicationId,
  name,
  description,
  environment,
  tags,
  server,
  variables,
  allVariables,
  volumes,
  includedServices,
  wantsDomain,
  hostname,
}: {
  manifest: CatalogApplicationDetail;
  applicationId?: string;
  name: string;
  description: string;
  environment: string;
  tags: string[];
  server: ServerSummary | null;
  variables: Record<string, string>;
  allVariables: CatalogApplicationDetail['services'][number]['variables'];
  volumes: { name: string; containerPath: string; service: string }[];
  includedServices: CatalogApplicationDetail['services'];
  wantsDomain: boolean;
  hostname: string;
}) {
  const envLabel = ENVIRONMENTS.find((e) => e.value === environment)?.label ?? environment;
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm">
      <Section title="Serviço">
        <Row label="Template" value={`${manifest.name} v${manifest.version}`} />
        {!applicationId && (
          <>
            <Row label="Nome do projeto" value={name} />
            {description && <Row label="Descrição" value={description} />}
            <Row label="Ambiente" value={envLabel} />
            {tags.length > 0 && <Row label="Tags" value={tags.join(', ')} />}
          </>
        )}
      </Section>

      <Section title="Servidor">
        <Row label="Servidor" value={server?.name ?? '—'} />
        <Row label="Endereço" value={server?.publicIp ?? server?.privateIp ?? '—'} />
      </Section>

      <Section title={`Serviços (${includedServices.length})`}>
        {includedServices.map((s) => (
          <Row key={s.name} label={s.name} value={s.image} />
        ))}
      </Section>

      {allVariables.length > 0 && (
        <Section title="Variáveis">
          {allVariables.map((v) => (
            <Row key={v.key} label={v.label} value={v.type === 'password' ? '••••••••' : variables[v.key] || '—'} />
          ))}
        </Section>
      )}

      {manifest.secretKeys.length > 0 && (
        <Section title="Secrets">
          <Row label={`${manifest.secretKeys.length} valor(es)`} value="gerados automaticamente" />
        </Section>
      )}

      {volumes.length > 0 && (
        <Section title="Volumes">
          {volumes.map((v) => (
            <Row key={`${v.service}-${v.name}`} label={v.name} value={v.containerPath} />
          ))}
        </Section>
      )}

      <Section title="Domínio">
        {wantsDomain ? (
          <>
            <Row label="Domínio" value={hostname} />
            <Row label="Serviço detectado" value={`${manifest.primaryService}:${manifest.primaryPort}`} />
          </>
        ) : (
          <Row label="Domínio" value="Nenhum — acessível só na rede interna do servidor" />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-3.5">
      <p className="section-label mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate text-right text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}

const DEPLOY_STATUS_BADGE: Record<OpsLogStatus, string> = {
  connecting: 'bg-slate-800 text-slate-300',
  running: 'bg-amber-500/15 text-amber-400',
  'done-ok': 'bg-green-500/15 text-green-400',
  'done-error': 'bg-red-500/15 text-red-400',
};

/**
 * Etapa final: o que importa aqui é "deu certo?" e "como eu acesso agora?", não
 * o log cru — que só interessa quando algo falha ou quando o usuário quer
 * acompanhar. Por isso o log fica atrás de um botão, e o estado de sucesso
 * puxa as credenciais geradas: senha de admin sorteada no deploy que não é
 * mostrada em lugar nenhum é senha perdida.
 */
/** Etapas reconhecidas na saída real do deploy — ver DeployProgress. */
const CATALOG_STAGES: ProgressStage[] = [
  { label: 'Preparando o diretório', match: /Preparando/i },
  { label: 'Enviando a configuração', match: /Gravando docker-compose|Gravando segredos/i },
  { label: 'Baixando as imagens', match: /Garantindo rede|Pulling|Downloading|Extracting/i },
  { label: 'Subindo os containers', match: /Subindo|Creating|Started|Container/i },
  { label: 'Verificando', match: /Aguardando|Associando dom/i },
];

interface DeployResult {
  ok: boolean;
  applicationId?: string;
  deploymentId?: string;
  domain?: { hostname: string } | null;
}

function DeployStep({
  applicationId,
  serverId,
  serviceParams,
  projectInfo,
  onResult,
  appName,
}: {
  applicationId?: string;
  serverId: string;
  serviceParams: Record<string, unknown>;
  projectInfo: { serverId: string; name: string; description?: string; environment: string; tags: string[] };
  onResult: (r: DeployResult) => void;
  appName: string;
}) {
  // Sem `applicationId`: veio direto da Biblioteca, sem projeto — cria um
  // projeto novo com os dados da etapa "Informações" antes de implantar o
  // serviço nele. Rápido (sem SSH), por isso fica fora do log de implantação.
  const [resolvedAppId, setResolvedAppId] = useState<string | null>(applicationId ?? null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (applicationId || resolvedAppId) return;
    apiFetch<{ id: string }>('/applications', { method: 'POST', body: JSON.stringify(projectInfo) })
      .then((app) => setResolvedAppId(app.id))
      .catch((e) => setCreateError(e instanceof Error ? e.message : 'Falha ao criar o projeto'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [status, setStatus] = useState<OpsLogStatus>('connecting');
  const [done, setDone] = useState<DeployResult | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);

  // Segredos gerados no deploy (senha de admin, root do banco) só existem
  // depois que o serviço foi criado — buscar antes devolveria vazio.
  useEffect(() => {
    if (!done?.ok || !done.applicationId || !done.deploymentId) return;
    apiFetch<Record<string, string>>(`/applications/${done.applicationId}/deployments/${done.deploymentId}/credentials`)
      .then((c) => setCredentials(Object.keys(c).length ? c : null))
      .catch(() => {});
  }, [done]);

  if (createError) {
    return <Alert variant="error">{createError}</Alert>;
  }
  if (!resolvedAppId) {
    return <p className="text-sm text-slate-400">Criando o projeto...</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <DeployProgress
        stages={CATALOG_STAGES}
        lastLine={lastLine}
        state={status === 'done-error' ? 'error' : status === 'done-ok' ? 'success' : 'running'}
        label={appName.charAt(0).toUpperCase()}
        title={status === 'done-error' ? 'A implantação falhou' : status === 'done-ok' ? `${appName} está no ar` : `Implantando ${appName}`}
        subtitle={
          status === 'done-error'
            ? 'Veja o log para entender o que aconteceu — nada foi deixado rodando pela metade.'
            : status === 'done-ok'
              ? done?.domain?.hostname
                ? 'Domínio configurado e certificado emitido.'
                : 'Disponível na rede interna do servidor.'
              : undefined
        }
        showLog={showLogs}
        onToggleLog={() => setShowLogs((v) => !v)}
      >
        {done?.ok && done.domain?.hostname && (
          <a href={`https://${done.domain.hostname}`} target="_blank" rel="noreferrer" className="btn-primary mt-4 px-4 py-2 text-sm">
            Abrir {done.domain.hostname}
          </a>
        )}
        {credentials && (
          <div className="mt-5 w-full max-w-md text-left">
            <CredentialsBox credentials={credentials} />
          </div>
        )}
      </DeployProgress>

      {/* O painel fica sempre montado: é ele que abre o WebSocket e conduz a
          operação. Esconder desmontando cancelaria a implantação em curso. */}
      <div className={showLogs ? 'mt-2' : 'sr-only'}>
        <TerminalWindow
          title="Implantação"
          statusSlot={
            <span className={`badge ${DEPLOY_STATUS_BADGE[status]}`}>
              {(status === 'running' || status === 'connecting') && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
              {status === 'connecting' && 'Conectando'}
              {status === 'running' && 'Executando'}
              {status === 'done-ok' && 'Concluído'}
              {status === 'done-error' && 'Falhou'}
            </span>
          }
          bodyClassName="flex h-[38vh] p-3"
        >
          <OpsLogPanel
            serverId={serverId}
            op="service-deploy"
            params={{ applicationId: resolvedAppId, ...serviceParams }}
            onStatusChange={setStatus}
            onLine={setLastLine}
            onDone={(ok, res) => {
              const r: DeployResult = {
                ok,
                applicationId: (res as { applicationId?: string })?.applicationId ?? resolvedAppId,
                deploymentId: (res as { deploymentId?: string })?.deploymentId,
                domain: (res as { domain?: { hostname: string } | null })?.domain,
              };
              setDone(r);
              onResult(r);
            }}
          />
        </TerminalWindow>
      </div>
    </div>
  );
}

/** Senhas sorteadas no deploy. Só existem aqui e na aba do projeto — nenhuma
 * delas é recuperável depois se o usuário não guardar, então a caixa aparece
 * aberta e com aviso, em vez de escondida atrás de mais um clique. */
function CredentialsBox({ credentials }: { credentials: Record<string, string> }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-900/15">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <IconKey className="h-3.5 w-3.5" aria-hidden />
          Credenciais geradas — guarde agora
        </p>
        <button
          onClick={() => setRevealed((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-amber-700 hover:underline dark:text-amber-400"
        >
          {revealed ? <IconEyeOff className="h-3.5 w-3.5" aria-hidden /> : <IconEye className="h-3.5 w-3.5" aria-hidden />}
          {revealed ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      <div className="space-y-1.5">
        {Object.entries(credentials).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-slate-900/50">
            <span className="shrink-0 text-[11px] font-medium text-slate-500">{key}</span>
            <code className="min-w-0 flex-1 truncate text-right font-mono text-xs text-slate-800 dark:text-slate-100">
              {revealed ? value : '•'.repeat(Math.min(value.length, 18))}
            </code>
            <button
              onClick={() => copy(key, value)}
              aria-label={`Copiar ${key}`}
              className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              {copied === key ? <IconCheck className="h-3.5 w-3.5 text-green-500" aria-hidden /> : <IconCopy className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-amber-700/80 dark:text-amber-400/70">
        Ficam disponíveis também na aba Ambiente do serviço, dentro do projeto.
      </p>
    </div>
  );
}
