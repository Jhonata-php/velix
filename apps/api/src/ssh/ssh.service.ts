import { Injectable } from '@nestjs/common';
import { Client, ClientChannel } from 'ssh2';

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
   * ponytail: síncrono (a requisição HTTP fica esperando o comando acabar).
   * Trocar por fila (BullMQ) + WebSocket de log ao vivo quando os comandos
   * passarem de alguns minutos ou o usuário precisar navegar para outra tela.
   */
  runCommand(options: SshConnectOptions, command: string, timeoutMs = 120_000): Promise<CommandResult> {
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
                stdout += data.toString();
              })
              .stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
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
