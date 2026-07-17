import { X509Certificate } from 'crypto';

export type CertificateState = 'ACTIVE' | 'EXPIRING' | 'NOT_FOUND' | 'ERROR';

export interface CertificateInfo {
  state: CertificateState;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

/** Acha o certificado de um domínio no acme.json real do Traefik (formato v3:
 * `{ "<resolver>": { "Certificates": [{ domain: { main, sans? }, certificate }] } }`,
 * `certificate` é o PEM completo em base64). */
export function findCertificateInAcmeJson(acmeJsonContent: string, hostname: string): string | null {
  try {
    const parsed = JSON.parse(acmeJsonContent);
    for (const resolver of Object.values(parsed) as Array<{ Certificates?: Array<{ domain?: { main?: string; sans?: string[] }; certificate?: string }> }>) {
      for (const cert of resolver?.Certificates ?? []) {
        if (cert.domain?.main === hostname || cert.domain?.sans?.includes(hostname)) {
          return cert.certificate ?? null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Interpreta um certificado real (PEM em base64) — emissor/validade de verdade, nada inventado. */
export function parseCertificate(base64Cert: string): CertificateInfo {
  try {
    const pem = Buffer.from(base64Cert, 'base64').toString('utf8');
    const cert = new X509Certificate(pem);
    const validTo = new Date(cert.validTo);
    const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return {
      state: daysRemaining < 0 ? 'NOT_FOUND' : daysRemaining < 15 ? 'EXPIRING' : 'ACTIVE',
      issuer: cert.issuer,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      daysRemaining,
    };
  } catch (err) {
    return { state: 'ERROR', error: err instanceof Error ? err.message : 'Falha ao interpretar certificado' };
  }
}
