import { Injectable } from '@nestjs/common';
import { Client } from 'ssh2';

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
}
