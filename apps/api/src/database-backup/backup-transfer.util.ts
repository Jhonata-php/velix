import { Client as FtpClient } from 'basic-ftp';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import type { ResolvedDestination } from './backup-destinations.service';

/**
 * Envia um arquivo local (já baixado do servidor do banco pro disco da API —
 * ver DatabaseBackupService.run) pro destino configurado. SFTP reaproveita o
 * `SshService` que já é o motor de toda conexão SSH do Velix (zero
 * dependência nova); FTP precisa de um client próprio, `basic-ftp`, porque é
 * um protocolo diferente que o `ssh2` não fala.
 */
export async function uploadToDestination(
  ssh: SshService,
  destination: ResolvedDestination,
  localPath: string,
  fileName: string,
): Promise<void> {
  const remotePath = `${destination.remotePath.replace(/\/+$/, '')}/${fileName}`;

  if (destination.protocol === 'sftp') {
    const options: SshConnectOptions = {
      host: destination.host,
      port: destination.port,
      username: destination.username,
      password: destination.password,
    };
    const result = await ssh.uploadFile(options, localPath, remotePath, 300_000);
    if (!result.ok) throw new Error(result.message || 'Falha ao enviar via SFTP');
    return;
  }

  const client = new FtpClient();
  try {
    await client.access({
      host: destination.host,
      port: destination.port,
      user: destination.username,
      password: destination.password,
      secure: false,
    });
    if (destination.remotePath && destination.remotePath !== '/') {
      await client.ensureDir(destination.remotePath);
    }
    await client.uploadFrom(localPath, fileName);
  } finally {
    client.close();
  }
}
