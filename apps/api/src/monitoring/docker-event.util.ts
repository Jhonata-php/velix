/**
 * `--filter type=container` restringe o stream a eventos de container (sem
 * isso `docker events` também manda eventos de rede/volume/imagem, que não
 * interessam aqui). O uso de `sudo` casa com o resto dos comandos Docker do
 * Velix (ver `dockerStatus`/`streamContainerLogs` em servers.service.ts).
 */
export const DOCKER_EVENTS_COMMAND = "sudo docker events --format '{{json .}}' --filter type=container";

export type DockerEventKind = 'stopped' | 'crashed' | 'restarted';

export interface NormalizedDockerEvent {
  kind: DockerEventKind;
  containerId: string;
  containerName: string;
  exitCode: number | null;
}

interface RawDockerEvent {
  Action?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
}

/**
 * `die` com exitCode 0 é parada limpa (`docker stop` ou saída normal do
 * processo) — tratada como "stopped". Qualquer outro código é "crashed".
 * `restart` é o evento que o Docker emite tanto pra `docker restart` manual
 * quanto pra política de restart automático — os dois contam como
 * "reiniciou" pra fins de alerta, sem distinguir a causa.
 */
export function parseDockerEventLine(line: string): NormalizedDockerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: RawDockerEvent;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const containerId = raw.Actor?.ID ?? '';
  if (!containerId) return null;
  const containerName = raw.Actor?.Attributes?.name ?? containerId;

  if (raw.Action === 'die') {
    const exitCode = Number(raw.Actor?.Attributes?.exitCode ?? '0');
    return {
      kind: exitCode === 0 ? 'stopped' : 'crashed',
      containerId,
      containerName,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
    };
  }

  if (raw.Action === 'restart') {
    return { kind: 'restarted', containerId, containerName, exitCode: null };
  }

  return null;
}
