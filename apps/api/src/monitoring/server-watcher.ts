import { Logger } from '@nestjs/common';
import { SshConnectOptions } from '../ssh/ssh.service';
import { MONITORING_SAMPLE_COMMAND, parseSampleLine, RawSample } from './metrics-sample.util';
import { DOCKER_EVENTS_COMMAND, parseDockerEventLine, NormalizedDockerEvent } from './docker-event.util';
import { nextBackoffMs } from './backoff.util';

/** Só o que o watcher usa de SshService — deixa o teste injetar um fake sem
 * precisar de uma conexão SSH de verdade. */
export interface ServerWatcherSsh {
  runCommand(
    options: SshConnectOptions,
    command: string,
    timeoutMs: number,
    onData?: (chunk: string, isError: boolean) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; message?: string }>;
}

const LOOP_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type StreamKind = 'sample' | 'events';

/**
 * Mantém duas streams SSH vivas pra um servidor: amostragem de métricas e
 * eventos de container. Se a conexão cair (rede, servidor reiniciou, etc.),
 * reconecta sozinho com backoff exponencial até `stop()` ser chamado.
 */
export class ServerWatcher {
  private readonly logger = new Logger(ServerWatcher.name);
  private stopped = false;
  private sampleAttempt = 0;
  private eventsAttempt = 0;
  private sampleBuffer = '';
  private eventsBuffer = '';
  private sampleController: AbortController | null = null;
  private eventsController: AbortController | null = null;
  private sampleReceivedData = false;
  private eventsReceivedData = false;

  constructor(
    private readonly serverId: string,
    private readonly options: SshConnectOptions,
    private readonly ssh: ServerWatcherSsh,
    private readonly onSample: (sample: RawSample) => void,
    private readonly onDockerEvent: (event: NormalizedDockerEvent) => void,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  start() {
    this.stopped = false;
    void this.runLoop('sample');
    void this.runLoop('events');
  }

  stop() {
    this.stopped = true;
    // aborta o comando SSH em andamento (se houver) — sem isso ele fica rodando
    // até cair sozinho, o que só acontece depois de 24h (LOOP_TIMEOUT_MS)
    this.sampleController?.abort();
    this.eventsController?.abort();
  }

  private handleChunk(kind: StreamKind, chunk: string) {
    if (kind === 'sample') this.sampleReceivedData = true;
    else this.eventsReceivedData = true;

    if (kind === 'sample') {
      this.sampleBuffer += chunk;
      const lines = this.sampleBuffer.split('\n');
      this.sampleBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const sample = parseSampleLine(rawLine);
        if (sample) this.onSample(sample);
      }
    } else {
      this.eventsBuffer += chunk;
      const lines = this.eventsBuffer.split('\n');
      this.eventsBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const event = parseDockerEventLine(rawLine);
        if (event) this.onDockerEvent(event);
      }
    }
  }

  private async runLoop(kind: StreamKind) {
    const command = kind === 'sample' ? MONITORING_SAMPLE_COMMAND : DOCKER_EVENTS_COMMAND;
    while (!this.stopped) {
      // ponytail: yield ao event loop real (fase de timers) a cada volta. Sem
      // isso, um runCommand/sleepFn que resolve só via microtask (sem I/O de
      // verdade — é exatamente o que o fake de teste faz) encadeia
      // Promise.resolve() infinitamente e nunca deixa o Node processar
      // setTimeout pendentes, travando o processo pra sempre. Em produção o
      // SSH real já é uma fronteira de I/O e isso não teria efeito prático.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const controller = new AbortController();
      if (kind === 'sample') this.sampleController = controller;
      else this.eventsController = controller;
      if (kind === 'sample') this.sampleReceivedData = false;
      else this.eventsReceivedData = false;

      const result = await this.ssh.runCommand(this.options, command, LOOP_TIMEOUT_MS, (chunk) => this.handleChunk(kind, chunk), controller.signal);
      const receivedData = kind === 'sample' ? this.sampleReceivedData : this.eventsReceivedData;

      this.logger[this.stopped ? 'debug' : 'warn'](
        `stream ${kind} do servidor ${this.serverId} encerrou (ok=${result.ok}, code=${result.code}${result.message ? `, message=${result.message}` : ''})`,
      );
      if (this.stopped) return;

      // Recebeu ao menos uma linha de dado real nesta tentativa: trata como
      // conexão que funcionou (não importa por que ela caiu depois) e zera o
      // backoff — senão um único blip travaria o próximo reconnect nesse
      // servidor no teto de 60s pro resto da vida dele.
      let attempt: number;
      if (receivedData) {
        attempt = 0;
        if (kind === 'sample') this.sampleAttempt = 0;
        else this.eventsAttempt = 0;
      } else {
        attempt = kind === 'sample' ? ++this.sampleAttempt : ++this.eventsAttempt;
      }
      const delayMs = nextBackoffMs(attempt);
      this.logger.debug(`reconectando stream ${kind} do servidor ${this.serverId} em ${delayMs}ms`);
      await this.sleepFn(delayMs);
    }
  }
}
