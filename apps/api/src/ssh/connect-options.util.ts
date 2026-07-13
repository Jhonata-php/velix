import { decryptCredential } from './crypto.util';
import { SshConnectOptions } from './ssh.service';

export interface ServerCredentialSource {
  publicIp: string | null;
  privateIp: string | null;
  hostname: string | null;
  sshPort: number;
  sshUser: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  credentialEnc: string;
}

export function buildConnectOptions(server: ServerCredentialSource): SshConnectOptions {
  const host = server.publicIp || server.privateIp || server.hostname;
  if (!host) throw new Error('Servidor não possui IP ou hostname cadastrado');
  const secret = decryptCredential(server.credentialEnc);
  return {
    host,
    port: server.sshPort,
    username: server.sshUser,
    password: server.authMethod === 'PASSWORD' ? secret : undefined,
    privateKey: server.authMethod === 'PRIVATE_KEY' ? secret : undefined,
  };
}
