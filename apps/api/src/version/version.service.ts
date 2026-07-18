import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface VersionInfo {
  /** Versão instalada (SemVer) — fonte única em apps/api/VERSION, nunca hardcoded em outro arquivo. */
  version: string;
  /** Commit curto — só existe se a imagem foi construída com `--build-arg GIT_COMMIT=...` (ver Dockerfile). */
  commit: string | null;
  /** Data do build — idem, via `--build-arg BUILD_DATE=...`. */
  buildDate: string | null;
  nodeVersion: string;
  uptimeSeconds: number;
}

/**
 * Ponto único de leitura da versão instalada — todo o resto do sistema
 * (healthcheck, Centro de Atualizações, `velix doctor`) consulta este
 * serviço em vez de reimplementar a leitura do arquivo VERSION.
 */
@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private readonly version: string;

  constructor() {
    this.version = this.readVersionFile();
  }

  private readVersionFile(): string {
    try {
      const raw = readFileSync(join(process.cwd(), 'VERSION'), 'utf8');
      const trimmed = raw.trim();
      if (!trimmed) throw new Error('arquivo VERSION está vazio');
      return trimmed;
    } catch (err) {
      this.logger.warn(`Não foi possível ler o arquivo VERSION (${err instanceof Error ? err.message : err}) — usando "0.0.0-unknown"`);
      return '0.0.0-unknown';
    }
  }

  getVersion(): string {
    return this.version;
  }

  getInfo(): VersionInfo {
    return {
      version: this.version,
      commit: process.env.GIT_COMMIT?.trim() || null,
      buildDate: process.env.BUILD_DATE?.trim() || null,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
