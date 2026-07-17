import { Injectable } from '@nestjs/common';
import { Client, ClientChannel } from 'ssh2';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface SshTestResult {
  ok: boolean;
  message: string;
  osRelease?: string;
}

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  message?: string;
}

@Injectable()
export class SshService {
  /**
   * Abre uma conexão SSH real, roda um comando até o fim e fecha a conexão.
   * Usado tanto pelo teste de conexão quanto por updates/Docker — comandos
   * de instalação podem levar minutos, por isso o timeout é bem generoso.
   *
   * `onData`, se passado, recebe cada pedaço de saída assim que chega — usado
   * pelo canal de log ao vivo (/ops) pra streaming em tempo real. Sem ele, o
   * comportamento é o de sempre (só resolve no final, com tudo bufferizado).
   */
  runCommand(
    options: SshConnectOptions,
    command: string,
    timeoutMs = 120_000,
    onData?: (chunk: string, isError: boolean) => void,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const conn = new Client();
      let settled = false;
      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.end();
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ ok: false, code: null, stdout: '', stderr: '', message: 'Timeout ao executar comando via SSH' });
      }, timeoutMs);

      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              finish({ ok: false, code: null, stdout: '', stderr: '', message: `Falha ao executar comando: ${err.message}` });
              return;
            }
            let stdout = '';
            let stderr = '';
            stream
              .on('close', (code: number | null) => {
                finish({ ok: code === 0, code, stdout, stderr });
              })
              .on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                onData?.(text, false);
              })
              .stderr.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                onData?.(text, true);
              });
          });
        })
        .on('error', (err) => {
          finish({ ok: false, code: null, stdout: '', stderr: '', message: `Falha na conexão SSH: ${err.message}` });
        })
        .connect({
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: options.privateKey,
          readyTimeout: Math.min(timeoutMs, 15_000),
        });
    });
  }

  async testConnection(options: SshConnectOptions, timeoutMs = 10_000): Promise<SshTestResult> {
    const result = await this.runCommand(options, 'cat /etc/os-release', timeoutMs);
    if (!result.ok) {
      return { ok: false, message: result.message ?? `Comando retornou código ${result.code}` };
    }
    return { ok: true, message: 'Conexão SSH validada com sucesso', osRelease: result.stdout };
  }

  private withConnection<T>(
    options: SshConnectOptions,
    handler: (conn: Client, done: (result: T) => void) => void,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve) => {
      const conn = new Client();
      let settled = false;
      const done = (result: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.end();
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, message: 'Timeout na operação SSH/SFTP' } as T), timeoutMs);

      conn
        .on('ready', () => handler(conn, done))
        .on('error', (err) => done({ ok: false, message: `Falha na conexão SSH: ${err.message}` } as T))
        .connect({
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: options.privateKey,
          readyTimeout: Math.min(timeoutMs, 15_000),
        });
    });
  }

  /** Baixa um arquivo remoto via SFTP para o disco local (usado para transferir dumps entre servidores). */
  downloadFile(options: SshConnectOptions, remotePath: string, localPath: string, timeoutMs = 300_000) {
    return this.withConnection<{ ok: boolean; message?: string }>(
      options,
      (conn, done) => {
        conn.sftp((err, sftp) => {
          if (err) return done({ ok: false, message: err.message });
          sftp.fastGet(remotePath, localPath, (err2) => {
            done(err2 ? { ok: false, message: err2.message } : { ok: true });
          });
        });
      },
      timeoutMs,
    );
  }

  /** Envia um arquivo local para o servidor remoto via SFTP. */
  uploadFile(options: SshConnectOptions, localPath: string, remotePath: string, timeoutMs = 300_000) {
    return this.withConnection<{ ok: boolean; message?: string }>(
      options,
      (conn, done) => {
        conn.sftp((err, sftp) => {
          if (err) return done({ ok: false, message: err.message });
          sftp.fastPut(localPath, remotePath, (err2) => {
            done(err2 ? { ok: false, message: err2.message } : { ok: true });
          });
        });
      },
      timeoutMs,
    );
  }

  /**
   * Escreve conteúdo num arquivo do servidor remoto de forma seguindo o padrão
   * usado pra qualquer arquivo gerenciado pelo Velix (config do Traefik, compose
   * de aplicação): grava local, envia via SFTP pra /tmp (sempre gravável) e move
   * pro destino final com sudo — evita problemas de permissão/escape de shell e
   * não expõe conteúdo sensível no `ps`. Usado por 2+ módulos (Traefik, Aplicações).
   */
  async writeRemoteFile(options: SshConnectOptions, remotePath: string, content: string, mode = '644', timeoutMs = 60_000) {
    const localTmp = join(tmpdir(), `velix-${randomUUID()}`);
    const remoteTmp = `/tmp/velix-${randomUUID()}`;
    await fs.writeFile(localTmp, content, { mode: 0o600 });
    try {
      const up = await this.uploadFile(options, localTmp, remoteTmp, timeoutMs);
      if (!up.ok) return { ok: false, message: `Falha ao enviar arquivo ao servidor: ${up.message}` };
      const dir = remotePath.slice(0, remotePath.lastIndexOf('/'));
      const mv = await this.runCommand(
        options,
        `sudo mkdir -p ${dir} && sudo mv ${remoteTmp} ${remotePath} && sudo chmod ${mode} ${remotePath}`,
        20_000,
      );
      if (!mv.ok) return { ok: false, message: `Falha ao gravar ${remotePath}: ${mv.stderr || mv.message}` };
      return { ok: true as const };
    } finally {
      await fs.unlink(localTmp).catch(() => undefined);
    }
  }

  /**
   * Abre um shell interativo (PTY) e mantém a conexão viva — usado pelo
   * terminal web. Quem chama é responsável por fechar `conn` quando acabar.
   */
  openShell(options: SshConnectOptions, timeoutMs = 15_000): Promise<{ conn: Client; stream: ClientChannel }> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;
      conn
        .on('ready', () => {
          conn.shell({ term: 'xterm-256color' }, (err, stream) => {
            if (err) {
              settled = true;
              conn.end();
              reject(err);
              return;
            }
            settled = true;
            resolve({ conn, stream });
          });
        })
        .on('error', (err) => {
          if (!settled) reject(err);
        })
        .connect({
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: options.privateKey,
          readyTimeout: timeoutMs,
        });
    });
  }
}
