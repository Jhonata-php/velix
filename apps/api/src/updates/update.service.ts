import { Injectable } from '@nestjs/common';
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

function resolveChannel(): UpdateChannel {
  const raw = process.env.UPDATE_CHANNEL?.trim().toLowerCase();
  return raw === 'beta' || raw === 'nightly' ? raw : 'stable';
}

@Injectable()
export class UpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly version: VersionService,
    private readonly github: GitHubReleaseService,
  ) {}

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

  async history(limit = 20) {
    return this.prisma.updateCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }
}
