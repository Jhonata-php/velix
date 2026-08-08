import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scanSecurityRisks, highestRiskLevel, validateManifest, type VelixManifest } from './catalog.util';
import { uptimeKumaManifest } from './manifests/uptime-kuma';
import { grafanaManifest } from './manifests/grafana';
import { prometheusManifest } from './manifests/prometheus';
import { postgresqlManifest } from './manifests/postgresql';
import { mysqlManifest } from './manifests/mysql';
import { redisManifest } from './manifests/redis';
import { minioManifest } from './manifests/minio';
import { giteaManifest } from './manifests/gitea';
import { wordpressManifest } from './manifests/wordpress';
import { n8nManifest } from './manifests/n8n';
import { nextcloudManifest } from './manifests/nextcloud';
import { mariadbManifest } from './manifests/mariadb';
import { mongodbManifest } from './manifests/mongodb';
import { vaultwardenManifest } from './manifests/vaultwarden';
import { jellyfinManifest } from './manifests/jellyfin';
import { photoprismManifest } from './manifests/photoprism';
import { navidromeManifest } from './manifests/navidrome';
import { audiobookshelfManifest } from './manifests/audiobookshelf';
import { nodeRedManifest } from './manifests/node-red';
import { ghostManifest } from './manifests/ghost';
import { paperlessNgxManifest } from './manifests/paperless-ngx';
import { ollamaManifest } from './manifests/ollama';
import { openWebuiManifest } from './manifests/open-webui';
import { homeAssistantManifest } from './manifests/home-assistant';
import { keycloakManifest } from './manifests/keycloak';
import { qbittorrentManifest } from './manifests/qbittorrent';
import { immichManifest } from './manifests/immich';
import { adminerManifest } from './manifests/adminer';
import { QUICK_MANIFESTS } from './manifests/quick-apps';

/**
 * Catálogo oficial do Velix — hoje é uma lista embutida no código (curada e
 * versionada junto do projeto, sem nada externo pra sincronizar). Fontes
 * externas (Portainer, Coolify, CasaOS...) viram um `CatalogSource` com
 * sincronização própria quando existirem — arquitetura deliberadamente
 * adiada até haver mais de uma fonte real, pra não construir tabela sem leitor.
 */
const OFFICIAL_MANIFESTS: VelixManifest[] = [
  uptimeKumaManifest,
  grafanaManifest,
  prometheusManifest,
  postgresqlManifest,
  mysqlManifest,
  redisManifest,
  minioManifest,
  giteaManifest,
  wordpressManifest,
  n8nManifest,
  nextcloudManifest,
  mariadbManifest,
  mongodbManifest,
  vaultwardenManifest,
  jellyfinManifest,
  photoprismManifest,
  navidromeManifest,
  audiobookshelfManifest,
  nodeRedManifest,
  ghostManifest,
  paperlessNgxManifest,
  ollamaManifest,
  openWebuiManifest,
  homeAssistantManifest,
  keycloakManifest,
  qbittorrentManifest,
  immichManifest,
  adminerManifest,
  ...QUICK_MANIFESTS,
];

/**
 * "Em alta" é curadoria, não métrica — o Velix não coleta instalação de
 * ninguém pra ranquear nada. É uma lista de slugs mantida à mão aqui em vez de
 * um campo em cada manifesto: assim dá pra mexer na vitrine (entrar, sair,
 * reordenar) sem tocar em 100 arquivos de definição de aplicação.
 */
const TRENDING_SLUGS = new Set([
  'immich',
  'homepage',
  'beszel',
  'dockge',
  'pocket-id',
  'stirling-pdf',
  'glance',
  'mealie',
  'actual-budget',
  'memos',
  'searxng',
  'forgejo',
  'adguard-home',
  'portainer',
  'nocodb',
  'it-tools',
  'n8n',
  'ollama',
  'open-webui',
  'uptime-kuma',
  'vaultwarden',
  'jellyfin',
  'paperless-ngx',
  'nextcloud',
]);

export interface CatalogInstallInfo {
  serverId: string;
  serverName: string;
  applicationId: string;
  status: string;
  hostname: string | null;
}

export interface CatalogApplicationSummary {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon: string;
  author: string;
  source: 'velix-official';
  trust: 'official';
  riskLevel: ReturnType<typeof highestRiskLevel>;
  trending: boolean;
  servicesCount: number;
  minResources: VelixManifest['minResources'];
  installed: CatalogInstallInfo[];
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cruza o catálogo com o que está de fato implantado em qualquer servidor —
   * é isso que decide se o card mostra "Instalar" ou "Abrir", não um campo solto no frontend. */
  private async installStateByManifestSlug(): Promise<Map<string, CatalogInstallInfo[]>> {
    const apps = await this.prisma.application.findMany({
      where: { status: { not: 'REMOVING' } },
      include: {
        server: { select: { id: true, name: true } },
        domains: { where: { status: 'ACTIVE' }, take: 1 },
        deployments: { select: { manifestSlug: true } },
      },
    });
    const map = new Map<string, CatalogInstallInfo[]>();
    for (const app of apps) {
      // Um projeto pode ter várias implantações de manifestos diferentes — cada
      // uma conta pra "instalado" só no manifesto que ela de fato é.
      for (const deployment of app.deployments) {
        if (!deployment.manifestSlug) continue;
        const list = map.get(deployment.manifestSlug) ?? [];
        list.push({
          serverId: app.serverId,
          serverName: app.server.name,
          applicationId: app.id,
          status: app.status,
          hostname: app.domains[0]?.hostname ?? null,
        });
        map.set(deployment.manifestSlug, list);
      }
    }
    return map;
  }

  private toSummary(manifest: VelixManifest, installed: CatalogInstallInfo[] = []): CatalogApplicationSummary {
    return {
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      version: manifest.version,
      icon: manifest.icon,
      author: manifest.author,
      source: 'velix-official',
      trust: 'official',
      riskLevel: highestRiskLevel(scanSecurityRisks(manifest)),
      trending: TRENDING_SLUGS.has(manifest.slug),
      servicesCount: manifest.services.length,
      minResources: manifest.minResources,
      installed,
    };
  }

  async list(): Promise<CatalogApplicationSummary[]> {
    const installState = await this.installStateByManifestSlug();
    return OFFICIAL_MANIFESTS.map((m) => this.toSummary(m, installState.get(m.slug) ?? []));
  }

  getManifest(slug: string): VelixManifest {
    const manifest = OFFICIAL_MANIFESTS.find((m) => m.slug === slug);
    if (!manifest) throw new NotFoundException(`Aplicação "${slug}" não encontrada no catálogo`);
    return manifest;
  }

  async getDetail(slug: string) {
    const manifest = this.getManifest(slug);
    const findings = scanSecurityRisks(manifest);
    const installState = await this.installStateByManifestSlug();
    return {
      ...this.toSummary(manifest, installState.get(manifest.slug) ?? []),
      documentationUrl: manifest.documentationUrl,
      repositoryUrl: manifest.repositoryUrl,
      websiteUrl: manifest.websiteUrl,
      screenshots: manifest.screenshots ?? [],
      services: manifest.services.map((s) => ({
        name: s.name,
        image: s.image,
        volumes: s.volumes ?? [],
        ports: s.ports ?? [],
        variables: s.variables ?? [],
        optional: !!s.optional,
        dependsOn: s.dependsOn ?? [],
      })),
      primaryService: manifest.primaryService,
      primaryPort: manifest.primaryPort,
      // Só o nome de cada segredo — o valor nunca existe fora do deploy de verdade.
      secretKeys: (manifest.secrets ?? []).map((s) => s.key),
      validation: validateManifest(manifest),
      securityFindings: findings,
    };
  }
}
