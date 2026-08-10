import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential } from '../ssh/crypto.util';

/**
 * Registra o próprio host do Velix como um servidor gerenciável.
 *
 * A ideia é não ter caminho especial: implantar uma aplicação "aqui" usa
 * exatamente o mesmo motor de qualquer servidor remoto — SSH, docker compose,
 * Traefik, tudo igual. Pra isso, o instalador gera um par de chaves, autoriza a
 * pública no root do host e deixa a privada no diretório de instalação (que a
 * API já enxerga por volume). Este serviço só cria a linha na tabela apontando
 * pra esse acesso.
 *
 * A alternativa seria dar o socket do Docker pra API e ter um "modo local"
 * paralelo em cada operação — o dobro de código pra manter, e cada recurso novo
 * precisaria ser escrito duas vezes.
 *
 * O endereço é `host.docker.internal`, que o compose mapeia pro gateway do host
 * (`extra_hosts: host-gateway`). Sem isso o container não teria como falar com
 * o SSH da própria máquina.
 */
@Injectable()
export class LocalServerService implements OnModuleInit {
  private readonly logger = new Logger(LocalServerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.VELIX_LOCAL_SERVER?.trim() !== 'true') return;

    const keyFile = process.env.VELIX_LOCAL_KEY_FILE?.trim() || '/host/velix/.velix-local-key';
    if (!existsSync(keyFile)) {
      this.logger.warn(`Servidor local habilitado, mas a chave ${keyFile} não existe — rode o instalador novamente.`);
      return;
    }

    try {
      const privateKey = readFileSync(keyFile, 'utf8');
      const name = process.env.VELIX_LOCAL_NAME?.trim() || 'Este servidor';
      const sshUser = process.env.VELIX_LOCAL_SSH_USER?.trim() || 'root';
      const sshPort = Number(process.env.VELIX_LOCAL_SSH_PORT?.trim() || '22');

      // O instalador já detecta o IP público (seção "Detectando rede") e
      // grava em VELIX_LOCAL_PUBLIC_IP — sem isso, o servidor local nunca
      // tinha publicIp preenchido, mesmo com a detecção funcionando. "127.0.0.1"
      // é o valor de fallback do instalador quando a detecção falha de
      // verdade — não é um IP público, não vale gravar como se fosse.
      const detectedIp = process.env.VELIX_LOCAL_PUBLIC_IP?.trim();
      const publicIp = detectedIp && detectedIp !== '127.0.0.1' ? detectedIp : undefined;

      const existing = await this.prisma.server.findFirst({ where: { isLocal: true } });

      // A credencial é regravada a cada start: se o instalador rodou de novo e
      // gerou outra chave, a linha antiga apontaria pra uma chave revogada.
      const data = {
        name,
        hostname: 'host.docker.internal',
        ...(publicIp ? { publicIp } : {}),
        sshUser,
        sshPort: Number.isFinite(sshPort) && sshPort > 0 ? sshPort : 22,
        authMethod: 'PRIVATE_KEY' as const,
        credentialEnc: encryptCredential(privateKey),
        isLocal: true,
      };

      if (existing) {
        await this.prisma.server.update({ where: { id: existing.id }, data });
        this.logger.log(`Servidor local sincronizado: ${name}`);
      } else {
        await this.prisma.server.create({
          data: { ...data, description: 'Servidor onde o Velix está instalado', environment: 'PRODUCTION' },
        });
        this.logger.log(`Servidor local registrado: ${name}`);
      }
    } catch (err) {
      // Nunca impedir a API de subir por causa disso — sem o servidor local o
      // painel continua funcionando pra servidores remotos.
      this.logger.warn(`Não foi possível registrar o servidor local: ${err instanceof Error ? err.message : err}`);
    }
  }
}
