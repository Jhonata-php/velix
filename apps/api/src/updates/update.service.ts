import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VersionService } from '../version/version.service';
import { GitHubReleaseService, ReleaseInfo, UpdateChannel } from './github-release.service';
import { compareSemver } from './semver.util';

export interface UpdateCheckSummary {
  installedVersion: string;
  channel: UpdateChannel;
  updateAvailable: boolean;
  release: ReleaseInfo | null;
  error: string | null;
  checkedAt: string;
}

export type TimelineEntry =
  | {
      id: string;
      type: 'update';
      at: string;
      fromVersion: string | null;
      toVersion: string;
      appliedBy: string;
    }
  | {
      id: string;
      type: 'check';
      at: string;
      installedVersion: string;
      latestVersion: string | null;
      channel: string;
      updateAvailable: boolean;
      releaseUrl: string | null;
      error: string | null;
    };

function resolveChannel(): UpdateChannel {
  const raw = process.env.UPDATE_CHANNEL?.trim().toLowerCase();
  return raw === 'beta' || raw === 'nightly' ? raw : 'stable';
}

@Injectable()
export class UpdateService implements OnModuleInit {
  private readonly logger = new Logger(UpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly version: VersionService,
    private readonly github: GitHubReleaseService,
  ) {}

  /**
   * A atualização acontece fora do painel (instalador rodando por SSH), então
   * não dá pra registrá-la no momento em que é disparada — mas o start da API
   * com uma versão diferente da última conhecida é o momento exato em que ela
   * terminou, e não tem como acontecer sem que uma troca tenha ocorrido.
   * `VELIX_UPDATED_BY` é gravado no .env pelo install.sh com o usuário que
   * rodou o sudo; se a atualização foi feita por fora dele, fica desconhecido.
   */
  async onModuleInit() {
    const toVersion = this.version.getVersion();
    try {
      const last = await this.prisma.updateEvent.findFirst({ orderBy: { appliedAt: 'desc' } });
      if (last?.toVersion === toVersion) return;

      await this.prisma.updateEvent.create({
        data: {
          fromVersion: last?.toVersion ?? null,
          toVersion,
          appliedBy: process.env.VELIX_UPDATED_BY?.trim() || 'desconhecido',
        },
      });
      this.logger.log(`Versão registrada: ${last?.toVersion ?? 'instalação inicial'} -> ${toVersion}`);
    } catch (err) {
      // Nunca derrubar a API por causa do registro de histórico.
      this.logger.warn(`Não foi possível registrar a versão instalada: ${err instanceof Error ? err.message : err}`);
    }
  }

  getCurrent() {
    return this.version.getInfo();
  }

  async check(opts: { force?: boolean } = {}): Promise<UpdateCheckSummary> {
    const channel = resolveChannel();
    const installedVersion = this.version.getVersion();
    const result = await this.github.getLatestRelease(channel, opts);
    const checkedAt = new Date();

    if (!result.ok) {
      await this.prisma.updateCheck.create({
        data: { installedVersion, channel, updateAvailable: false, error: result.error, checkedAt },
      });
      return { installedVersion, channel, updateAvailable: false, release: null, error: result.error, checkedAt: checkedAt.toISOString() };
    }

    const release = result.release;
    const updateAvailable = !!release && compareSemver(release.version, installedVersion) > 0;

    await this.prisma.updateCheck.create({
      data: {
        installedVersion,
        latestVersion: release?.version ?? null,
        channel,
        updateAvailable,
        releaseUrl: release?.url ?? null,
        publishedAt: release?.publishedAt ? new Date(release.publishedAt) : null,
        checkedAt,
      },
    });

    return { installedVersion, channel, updateAvailable, release, error: null, checkedAt: checkedAt.toISOString() };
  }

  /**
   * Linha do tempo única: atualizações aplicadas e verificações, ordenadas
   * juntas. São duas tabelas porque respondem a perguntas diferentes ("quando
   * mudou de versão" x "quando olhamos o GitHub"), mas na tela quem lê quer um
   * histórico só, e as atualizações são a parte que interessa.
   */
  async history(limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const [events, checks] = await Promise.all([
      this.prisma.updateEvent.findMany({ orderBy: { appliedAt: 'desc' }, take }),
      this.prisma.updateCheck.findMany({ orderBy: { checkedAt: 'desc' }, take }),
    ]);

    const timeline: TimelineEntry[] = [
      ...events.map((e) => ({
        id: e.id,
        type: 'update' as const,
        at: e.appliedAt.toISOString(),
        fromVersion: e.fromVersion,
        toVersion: e.toVersion,
        appliedBy: e.appliedBy,
      })),
      ...checks.map((c) => ({
        id: c.id,
        type: 'check' as const,
        at: c.checkedAt.toISOString(),
        installedVersion: c.installedVersion,
        latestVersion: c.latestVersion,
        channel: c.channel,
        updateAvailable: c.updateAvailable,
        releaseUrl: c.releaseUrl,
        error: c.error,
      })),
    ];

    return timeline.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
  }
}
