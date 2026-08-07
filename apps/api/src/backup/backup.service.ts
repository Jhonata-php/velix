import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'fs';
import { join } from 'path';
import { createGzip } from 'zlib';
import { PrismaService } from '../prisma/prisma.service';

const BACKUP_DIR_NAME = 'backups';

/**
 * Backup do banco e do .env.
 *
 * O que se perde sem isso não é "alguns dados": o `.env` guarda o
 * VELIX_CREDENTIAL_SECRET, e sem ele *todas* as credenciais SSH e tokens
 * gravados ficam irrecuperáveis — o banco vira lixo cifrado. Por isso os dois
 * são copiados juntos, sempre; separá-los criaria a chance de restaurar um sem
 * o outro, que é o mesmo que não ter backup.
 *
 * Os arquivos ficam no diretório de instalação, que a API já enxerga por volume
 * e que vive no host — sobrevive a `docker compose down`, ao contrário de um
 * volume anônimo. Envio para destino externo (S3) é o passo seguinte; guardar
 * no mesmo disco protege contra engano humano e falha de container, não contra
 * perda do disco.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly hostDir = process.env.VELIX_HOST_DIR?.trim() || '/host/velix';
  private readonly retentionDays = Number(process.env.VELIX_BACKUP_RETENTION_DAYS ?? '14');

  constructor(private readonly prisma: PrismaService) {}

  private get backupDir() {
    return join(this.hostDir, BACKUP_DIR_NAME);
  }

  isAvailable() {
    return existsSync(this.hostDir);
  }

  async list() {
    const runs = await this.prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
    return {
      available: this.isAvailable(),
      directory: this.backupDir,
      retentionDays: this.retentionDays,
      runs,
    };
  }

  /** 03:15 todo dia: fora do horário de uso e longe da virada, onde costuma
   * haver disputa por CPU com rotações de log e cron de sistema. */
  @Cron('15 3 * * *')
  async scheduled() {
    if (!this.isAvailable()) return;
    await this.run('scheduled');
  }

  async run(trigger: 'scheduled' | 'manual' = 'manual') {
    if (!this.isAvailable()) {
      throw new NotFoundException('Diretório de instalação não está montado — backup indisponível nesta instalação.');
    }

    mkdirSync(this.backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `velix-${stamp}.sql.gz`;
    const target = join(this.backupDir, fileName);

    const runRow = await this.prisma.backupRun.create({ data: { trigger, fileName } });

    try {
      await this.dumpDatabase(target);

      // O .env é copiado a cada backup, não uma vez só: ele muda (senha do
      // admin, domínio, token). Um .env velho ao lado de um dump novo
      // restauraria uma instalação que não é a que existia.
      const envSource = join(this.hostDir, '.env');
      if (existsSync(envSource)) {
        copyFileSync(envSource, join(this.backupDir, `velix-${stamp}.env`));
      }

      const size = statSync(target).size;
      await this.prisma.backupRun.update({
        where: { id: runRow.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), sizeBytes: size },
      });

      this.pruneOld();
      this.logger.log(`Backup concluído: ${fileName} (${Math.round(size / 1024)} KB)`);
      return { ok: true, fileName, sizeBytes: size };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no backup';
      await this.prisma.backupRun.update({
        where: { id: runRow.id },
        data: { status: 'ERROR', finishedAt: new Date(), error: message.slice(0, 500) },
      });
      this.logger.error(`Backup falhou: ${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * pg_dump escrevendo direto num gzip, sem passar pela memória do Node: um
   * banco grande carregado em string derrubaria a API por heap.
   */
  private dumpDatabase(target: string): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definido');

    return new Promise((resolve, reject) => {
      // A URL vai por variável de ambiente, não como argumento: argumentos são
      // visíveis em `ps` para qualquer processo do container. O libpq aceita uma
      // URI completa em PGDATABASE, que é o que permite não usar -d.
      const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', '--clean', '--if-exists'], {
        env: { ...process.env, PGDATABASE: url },
      });

      const gzip = createGzip();
      const out = createWriteStream(target, { mode: 0o600 });

      let stderr = '';
      dump.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += chunk.toString();
      });

      // Só resolve quando o pg_dump saiu com 0 E o arquivo terminou de ser
      // escrito. Resolver no primeiro dos dois deixaria passar um dump truncado
      // (arquivo fechado antes do fim) ou um arquivo incompleto (processo
      // encerrado, buffer do gzip ainda em trânsito) — backup que parece bom e
      // não restaura é pior que backup que falhou.
      let exitCode: number | null = null;
      let fileClosed = false;
      let settled = false;

      const finish = () => {
        if (settled || exitCode === null || !fileClosed) return;
        settled = true;
        if (exitCode === 0) resolve();
        else reject(new Error(stderr.trim().slice(0, 300) || `pg_dump saiu com código ${exitCode}`));
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      dump.on('error', (err) => fail(new Error(`pg_dump indisponível: ${err.message}`)));
      gzip.on('error', fail);
      out.on('error', fail);

      dump.stdout.pipe(gzip).pipe(out);

      dump.on('close', (code) => {
        exitCode = code ?? 1;
        finish();
      });
      out.on('close', () => {
        fileClosed = true;
        finish();
      });
    });
  }

  /** Retenção por idade: sem isso o disco enche sozinho e o backup vira a causa
   * da queda que deveria evitar. */
  private pruneOld() {
    const cutoff = Date.now() - this.retentionDays * 86400_000;
    for (const file of readdirSync(this.backupDir)) {
      if (!file.startsWith('velix-')) continue;
      const path = join(this.backupDir, file);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        // Arquivo sumiu no meio do caminho — nada a fazer, e não é motivo de erro.
      }
    }
  }
}
