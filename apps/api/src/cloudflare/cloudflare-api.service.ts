import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareDnsRecord {
  id: string;
  zone_id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export interface CreateDnsRecordInput {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
}

// ponytail: fetch nativo do Node 20 em vez de um SDK da Cloudflare — a API é
// só uns poucos endpoints REST. Trocar por SDK oficial se precisarmos de
// recursos avançados (rate-limit automático, paginação de todos os endpoints).
@Injectable()
export class CloudflareApiService {
  private async request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    let body: CloudflareEnvelope<T>;
    try {
      body = (await res.json()) as CloudflareEnvelope<T>;
    } catch {
      throw new BadGatewayException('Resposta inválida da API da Cloudflare');
    }

    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(body.errors?.[0]?.message ?? 'Token da Cloudflare inválido ou sem permissão');
    }
    if (!body.success) {
      throw new BadGatewayException(body.errors?.[0]?.message ?? 'Erro na API da Cloudflare');
    }
    return body.result;
  }

  verifyToken(token: string) {
    return this.request<{ id: string; status: string }>(token, '/user/tokens/verify');
  }

  getAccountEmail(token: string) {
    return this.request<{ email: string }>(token, '/user');
  }

  listZones(token: string) {
    return this.request<CloudflareZone[]>(token, '/zones?per_page=50');
  }

  listRecords(token: string, zoneId: string) {
    return this.request<CloudflareDnsRecord[]>(token, `/zones/${zoneId}/dns_records?per_page=100`);
  }

  createRecord(token: string, zoneId: string, data: CreateDnsRecordInput) {
    return this.request<CloudflareDnsRecord>(token, `/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ ttl: 1, proxied: false, ...data }),
    });
  }

  updateRecord(token: string, zoneId: string, recordId: string, data: Partial<CreateDnsRecordInput>) {
    return this.request<CloudflareDnsRecord>(token, `/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteRecord(token: string, zoneId: string, recordId: string) {
    return this.request<{ id: string }>(token, `/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
    });
  }

  /** Seção 27 do spec: varre todas as zonas atrás de registros que apontam para um IP. */
  async findRecordsByContent(token: string, content: string) {
    const zones = await this.listZones(token);
    const matches: (CloudflareDnsRecord & { zoneName: string })[] = [];
    for (const zone of zones) {
      const records = await this.listRecords(token, zone.id);
      for (const record of records) {
        if (record.content === content) {
          matches.push({ ...record, zoneName: zone.name });
        }
      }
    }
    return matches;
  }
}
