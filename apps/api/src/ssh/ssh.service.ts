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

@Injectable()
export class SshService {
  /**
   * Abre uma conexão SSH real, roda `cat /etc/os-release` para confirmar
   * acesso de comando (não só o handshake) e fecha a conexão.
   */
  testConnection(options: SshConnectOptions, timeoutMs = 10_000): Promise<SshTestResult> {
    return new Promise((resolve) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.end();
        resolve({ ok: false, message: 'Timeout ao conectar via SSH' });
      }, timeoutMs);

      conn
        .on('ready', () => {
          conn.exec('cat /etc/os-release', (err, stream) => {
            if (err) {
              clearTimeout(timer);
              conn.end();
              resolve({ ok: false, message: `Conectado, mas falhou ao executar comando: ${err.message}` });
              return;
            }
            let output = '';
            stream
              .on('close', () => {
                clearTimeout(timer);
                conn.end();
                resolve({ ok: true, message: 'Conexão SSH validada com sucesso', osRelease: output });
              })
              .on('data', (data: Buffer) => {
                output += data.toString();
              });
          });
        })
        .on('error', (err) => {
          clearTimeout(timer);
          resolve({ ok: false, message: `Falha na conexão SSH: ${err.message}` });
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
