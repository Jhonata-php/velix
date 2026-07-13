import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CloudflareApiService, CreateDnsRecordInput } from './cloudflare-api.service';

@Injectable()
export class CloudflareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: CloudflareApiService,
  ) {}

  private async getActiveAccount() {
    const account = await this.prisma.cloudflareAccount.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!account) {
      throw new NotFoundException('Nenhuma conta Cloudflare configurada. Configure em Configurações.');
    }
    return account;
  }

  private async getToken() {
    const account = await this.getActiveAccount();
    return decryptCredential(account.apiTokenEnc);
  }

  async getAccountStatus() {
    const account = await this.prisma.cloudflareAccount.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!account) return { connected: false };
    return { connected: true, id: account.id, email: account.email, createdAt: account.createdAt };
  }

  async connect(apiToken: string) {
    const verify = await this.api.verifyToken(apiToken);
    if (verify.status !== 'active') {
      throw new BadRequestException(`Token da Cloudflare está com status "${verify.status}"`);
    }
    const { email } = await this.api.getAccountEmail(apiToken).catch(() => ({ email: undefined }));

    // Só uma conta ativa por instalação: remove qualquer configuração anterior.
    await this.prisma.cloudflareAccount.deleteMany({});
    const account = await this.prisma.cloudflareAccount.create({
      data: { apiTokenEnc: encryptCredential(apiToken), email },
    });
    return { connected: true, id: account.id, email: account.email, createdAt: account.createdAt };
  }

  async disconnect() {
    await this.prisma.cloudflareAccount.deleteMany({});
    return { connected: false };
  }

  async listZones() {
    const token = await this.getToken();
    return this.api.listZones(token);
  }

  async listRecords(zoneId: string) {
    const token = await this.getToken();
    return this.api.listRecords(token, zoneId);
  }

  async createRecord(zoneId: string, data: CreateDnsRecordInput) {
    const token = await this.getToken();
    return this.api.createRecord(token, zoneId, data);
  }

  async updateRecord(zoneId: string, recordId: string, data: Partial<CreateDnsRecordInput>) {
    const token = await this.getToken();
    return this.api.updateRecord(token, zoneId, recordId, data);
  }

  async deleteRecord(zoneId: string, recordId: string) {
    const token = await this.getToken();
    return this.api.deleteRecord(token, zoneId, recordId);
  }

  async lookupByIp(ip: string) {
    const token = await this.getToken();
    return this.api.findRecordsByContent(token, ip);
  }
}
