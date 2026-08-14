import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Client as FtpClient } from 'basic-ftp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import type { ResolvedDestination } from './backup-destinations.service';

/** Chave/caminho remoto: `remotePath` (diretório FTP/SFTP ou prefixo dentro
 * do bucket S3) + nome do arquivo, sem barras duplicadas nem barra inicial
 * (S3 trata "/foo" e "foo" como chaves diferentes — evita criar um "diretório"
 * vazio de nome vazio no bucket). */
function joinRemotePath(remotePath: string, fileName: string): string {
  const prefix = remotePath.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${fileName}` : fileName;
}

/**
 * Envia um arquivo local (já baixado do servidor do banco pro disco da API —
 * ver DatabaseBackupService.run) pro destino configurado. SFTP reaproveita o
 * `SshService` que já é o motor de toda conexão SSH do Velix; FTP usa
 * `basic-ftp` (protocolo que o `ssh2` não fala); S3 usa o SDK oficial da AWS
 * — funciona com qualquer provedor S3-compatível (MinIO, R2, B2...) apontando
 * `endpoint` pro host customizado.
 */
export async function uploadToDestination(
  ssh: SshService,
  destination: ResolvedDestination,
  localPath: string,
  fileName: string,
): Promise<void> {
  if (destination.protocol === 's3') {
    const client = new S3Client({
      region: destination.region || 'us-east-1',
      endpoint: destination.host || undefined,
      forcePathStyle: !!destination.host, // endpoint customizado: quase sempre precisa de path-style (MinIO etc.)
      credentials: { accessKeyId: destination.username, secretAccessKey: destination.password },
    });
    try {
      const { size } = await stat(localPath);
      await client.send(
        new PutObjectCommand({
          Bucket: destination.bucket!,
          Key: joinRemotePath(destination.remotePath, fileName),
          Body: createReadStream(localPath),
          ContentLength: size,
        }),
      );
    } finally {
      client.destroy();
    }
    return;
  }

  const remotePath = `/${joinRemotePath(destination.remotePath, fileName)}`;

  if (destination.protocol === 'sftp') {
    const options: SshConnectOptions = {
      host: destination.host!,
      port: destination.port!,
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
      host: destination.host!,
      port: destination.port!,
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
