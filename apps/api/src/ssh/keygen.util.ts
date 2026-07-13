import { generateKeyPairSync, randomBytes } from 'crypto';

function sshString(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function sshUint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function toOpenSshPublicKey(rawPublicKey: Buffer): string {
  const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(rawPublicKey)]);
  return `ssh-ed25519 ${blob.toString('base64')} velix`;
}

// ponytail: monta o container "openssh-key-v1" na mão (Node só exporta PKCS8
// puro para ed25519, que o ssh2 não entende) — formato documentado em
// PROTOCOL.key do OpenSSH. Só o caso sem senha/cifra ("none") é suportado.
function toOpenSshPrivateKey(rawPublicKey: Buffer, rawPrivateSeed: Buffer): string {
  const pubBlob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(rawPublicKey)]);
  const privBlob = Buffer.concat([
    sshString(Buffer.from('ssh-ed25519')),
    sshString(rawPublicKey),
    sshString(Buffer.concat([rawPrivateSeed, rawPublicKey])),
    sshString(Buffer.from('velix')),
  ]);

  const checkInt = randomBytes(4);
  let section = Buffer.concat([checkInt, checkInt, privBlob]);
  const blockSize = 8;
  let padByte = 1;
  while (section.length % blockSize !== 0) {
    section = Buffer.concat([section, Buffer.from([padByte++])]);
  }

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    sshString(Buffer.from('none')), // ciphername
    sshString(Buffer.from('none')), // kdfname
    sshString(Buffer.alloc(0)), // kdfoptions
    sshUint32(1), // number of keys
    sshString(pubBlob),
    sshString(section),
  ]);

  const base64 = body.toString('base64');
  const lines = base64.match(/.{1,70}/g) ?? [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

export interface GeneratedKeyPair {
  publicKey: string;
  privateKey: string;
}

/** Gera um par de chaves ed25519 novo — usado para instalar em servidores sem precisar colar uma chave existente. */
export function generateSshKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const privJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string };
  const rawPublicKey = Buffer.from(pubJwk.x, 'base64url');
  const rawPrivateSeed = Buffer.from(privJwk.d, 'base64url');

  return {
    publicKey: toOpenSshPublicKey(rawPublicKey),
    privateKey: toOpenSshPrivateKey(rawPublicKey, rawPrivateSeed),
  };
}
