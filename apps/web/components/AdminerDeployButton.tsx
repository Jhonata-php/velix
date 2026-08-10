'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { Alert } from './Alert';
import { InstallLogModal } from './InstallLogModal';
import { IconGlobe, IconExternalLink } from './icons';

const ADMINER_PORT = 8080;
const MAX_ATTEMPTS = 5;

/** Rótulo curto e legível pra sugestão de domínio aleatório — não precisa ser
 * criptograficamente forte, só improvável de colidir com outro subdomínio já
 * usado na mesma zona. Duplicado de propósito (mesma função pequena já usada
 * em GitDeployWizard.tsx/DeployWizard.tsx/DomainsTab, sem um lugar comum pra
 * todas ainda). */
function randomDomainLabel(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'app'}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Gera um hostname livre e cria o domínio — confere contra os registros DNS
 * reais da zona (não só a tabela do Velix) antes de criar, porque um domínio
 * pode ter sido criado direto no painel da Cloudflare, fora do Velix. Tenta
 * de novo com outro nome em caso de colisão (na Cloudflare ou na checagem
 * interna do próprio Velix, que devolve 409).
 */
async function createUniqueDomain(
  applicationId: string,
  serviceName: string,
  baseLabel: string,
): Promise<{ hostname: string } | { error: string }> {
  let zones: { id: string; name: string }[];
  try {
    zones = await apiFetch<{ id: string; name: string }[]>('/cloudflare/zones');
  } catch {
    return { error: 'Adminer implantado, mas sem conta Cloudflare conectada — sem domínio automático. Configure um manualmente na aba Domínios.' };
  }
  if (zones.length === 0) {
    return { error: 'Adminer implantado, mas nenhuma zona Cloudflare encontrada — sem domínio automático. Configure um manualmente na aba Domínios.' };
  }
  const zone = zones[0];

  let taken = new Set<string>();
  try {
    const records = await apiFetch<{ name: string }[]>(`/cloudflare/zones/${zone.id}/records`);
    taken = new Set(records.map((r) => r.name.toLowerCase()));
  } catch {
    // Sem conseguir listar, segue sem essa checagem — o POST de criação
    // ainda protege contra duplicata na própria tabela do Velix.
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hostname = `${randomDomainLabel(baseLabel)}.${zone.name}`;
    if (taken.has(hostname.toLowerCase())) continue;
    try {
      await apiFetch(`/applications/${applicationId}/domains`, {
        method: 'POST',
        body: JSON.stringify({ hostname, serviceName, port: ADMINER_PORT, createDnsRecord: true }),
      });
      return { hostname };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) continue; // já existe no Velix — tenta outro nome
      return { error: e instanceof Error ? e.message : 'Falha ao criar domínio automático pro Adminer' };
    }
  }
  return { error: 'Não consegui gerar um domínio livre pro Adminer depois de várias tentativas.' };
}

/**
 * Implanta o Adminer nesse projeto e já cria um domínio HTTPS automático pra
 * ele (via zona Cloudflare conectada) — sem isso o usuário implantava o
 * Adminer e não tinha como abrir de fora, já que o container não publica
 * porta nem tem domínio por padrão.
 */
export function AdminerDeployButton({
  applicationId,
  serverId,
  containerName,
  onChange,
}: {
  applicationId: string;
  serverId: string;
  containerName: string;
  onChange: () => void;
}) {
  const [deploying, setDeploying] = useState(false);
  const [linking, setLinking] = useState(false);
  const [result, setResult] = useState<{ hostname: string } | { error: string } | null>(null);

  async function afterDeploy(ok: boolean) {
    if (!ok) return;
    setLinking(true);
    setResult(null);
    const outcome = await createUniqueDomain(applicationId, 'adminer', containerName);
    setResult(outcome);
    setLinking(false);
    onChange();
  }

  return (
    <div>
      <button
        onClick={() => setDeploying(true)}
        disabled={deploying || linking}
        className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
      >
        <IconGlobe className="h-4 w-4" aria-hidden />
        {linking ? 'Configurando domínio...' : 'Abrir interface web'}
      </button>

      {result && 'hostname' in result && (
        <div className="mt-2">
          <a
            href={`https://${result.hostname}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {result.hostname} <IconExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      )}
      {result && 'error' in result && (
        <div className="mt-2">
          <Alert variant="warning">{result.error}</Alert>
        </div>
      )}

      {deploying && (
        <InstallLogModal
          serverId={serverId}
          op="service-deploy"
          params={{ applicationId, manifestSlug: 'adminer', variables: { DEFAULT_SERVER: containerName } }}
          title="Implantando Adminer"
          onClose={() => setDeploying(false)}
          onDone={afterDeploy}
        />
      )}
    </div>
  );
}
