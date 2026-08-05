import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, accessSync, constants } from 'fs';
import { join } from 'path';

export type SelfUpdateState = 'idle' | 'requested' | 'running' | 'success' | 'error';

export interface SelfUpdateStatus {
  available: boolean;
  state: SelfUpdateState;
  message: string | null;
  requestedBy: string | null;
  fromVersion: string | null;
  updatedAt: string | null;
}

const REQUEST_FILE = '.velix-update-request';
const STATUS_FILE = '.velix-update-status';

/**
 * A API não executa a atualização — ela pede.
 *
 * Quem roda a API é um dos containers que a atualização substitui: o processo
 * que disparasse o rebuild morreria no meio dele. A saída usual é montar
 * /var/run/docker.sock no container, o que dá à aplicação web controle total do
 * Docker do host, ou seja, root no servidor. Aqui a API só escreve um arquivo
 * de pedido no diretório de instalação, que ela enxerga por volume; o host
 * observa esse arquivo com um path unit do systemd e executa um script fixo,
 * sem nenhum parâmetro vindo da rede (ver install.sh). O pior caso de um
 * comprometimento da API é disparar a atualização oficial do Velix.
 *
 * Sem VELIX_HOST_DIR montado (instalação anterior a este recurso, ou execução
 * fora do compose), `available` é false e a tela cai no passo a passo manual.
 */
@Injectable()
export class SelfUpdateService {
  private readonly logger = new Logger(SelfUpdateService.name);
  private readonly hostDir = process.env.VELIX_HOST_DIR?.trim() || '';

  /** O diretório precisa existir e ser gravável — montado somente-leitura não serve. */
  isAvailable(): boolean {
    if (!this.hostDir || !existsSync(this.hostDir)) return false;
    try {
      accessSync(this.hostDir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  getStatus(): SelfUpdateStatus {
    const base: SelfUpdateStatus = {
      available: this.isAvailable(),
      state: 'idle',
      message: null,
      requestedBy: null,
      fromVersion: null,
      updatedAt: null,
    };

    if (!base.available) return base;

    // Pedido ainda no disco = o host não pegou (path unit desativado, ou a
    // atualização acabou de ser pedida). "requested" é o estado intermediário.
    if (existsSync(join(this.hostDir, REQUEST_FILE))) {
      return { ...base, state: 'requested', message: 'Aguardando o servidor iniciar a atualização' };
    }

    try {
      const raw = readFileSync(join(this.hostDir, STATUS_FILE), 'utf8');
      const parsed = JSON.parse(raw) as Partial<SelfUpdateStatus> & { state?: SelfUpdateState };
      return {
        ...base,
        state: parsed.state ?? 'idle',
        message: parsed.message ?? null,
        requestedBy: parsed.requestedBy ?? null,
        fromVersion: parsed.fromVersion ?? null,
        updatedAt: parsed.updatedAt ?? null,
      };
    } catch {
      return base;
    }
  }

  /** `requestedBy` é gravado no histórico como autor da atualização (ver UpdateService). */
  request(requestedBy: string): SelfUpdateStatus {
    if (!this.isAvailable()) {
      throw new BadRequestException(
        'Atualização pelo painel indisponível nesta instalação — rode o instalador no servidor.',
      );
    }

    const current = this.getStatus();
    if (current.state === 'requested' || current.state === 'running') {
      throw new BadRequestException('Já existe uma atualização em andamento.');
    }

    // JSON simples, lido no host com grep/cut — nada de aspas vindas do usuário
    // atravessando isso: o nome é sanitizado aqui.
    const safeAuthor = requestedBy.replace(/["\\\r\n]/g, '').slice(0, 120) || 'painel';
    const payload = JSON.stringify({ requestedBy: safeAuthor, requestedAt: new Date().toISOString() });

    writeFileSync(join(this.hostDir, REQUEST_FILE), `${payload}\n`, { mode: 0o644 });
    this.logger.log(`Atualização solicitada por ${safeAuthor}`);

    return { ...this.getStatus(), state: 'requested', requestedBy: safeAuthor };
  }
}
