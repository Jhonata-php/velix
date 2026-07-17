/**
 * Funções puras de renderização/parse da config do Traefik — separadas do
 * serviço (que faz I/O via SSH) justamente pra serem testáveis sem servidor.
 * Ver traefik.util.spec.ts pra o self-check.
 */

export const VELIX_ROOT = '/opt/velix';
export const TRAEFIK_DIR = `${VELIX_ROOT}/traefik`;
export const TRAEFIK_DYNAMIC_DIR = `${TRAEFIK_DIR}/dynamic`;
export const TRAEFIK_CERTS_DIR = `${TRAEFIK_DIR}/certs`;
export const TRAEFIK_LOGS_DIR = `${TRAEFIK_DIR}/logs`;
export const PROXY_NETWORK = 'velix-proxy';
export const TRAEFIK_IMAGE = 'traefik:v3.3';
export const TRAEFIK_CONTAINER = 'velix-traefik';

/** Nome determinístico e válido de router/service no Traefik a partir do id do domínio. */
export function routerName(domainId: string): string {
  return `velix-${domainId.replace(/-/g, '')}`;
}

/**
 * O Let's Encrypt rejeita a criação da conta ACME inteira (não só um domínio)
 * se o email de contato não tiver um TLD público válido — `.local`/`.test`/
 * sem ponto etc. Isso já causou uma instalação real quebrar silenciosamente
 * (toda emissão de certificado falhava sem nenhum sinal na tela), por isso
 * validado aqui antes de gravar a config, não só no formulário do frontend.
 */
const INVALID_EMAIL_TLDS = new Set(['local', 'test', 'localhost', 'internal', 'lan', 'example']);

export function isValidAcmeEmail(email: string): boolean {
  const match = /^[^\s@]+@[^\s@]+\.([a-z]{2,})$/i.exec(email.trim());
  if (!match) return false;
  return !INVALID_EMAIL_TLDS.has(match[1].toLowerCase());
}

/** Arquivo estático do Traefik (traefik.yml). DNS-01 via Cloudflare, HTTP->HTTPS,
 * dashboard/API inseguros DESLIGADOS por padrão (nunca expor sem auth). */
export function renderStaticConfig(acmeEmail: string): string {
  return `global:
  checkNewVersion: false
  sendAnonymousUsage: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: ${PROXY_NETWORK}
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  velix-le:
    acme:
      email: ${acmeEmail}
      storage: /etc/traefik/certs/acme.json
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"

api:
  dashboard: false
  insecure: false

log:
  level: INFO
  filePath: /var/log/traefik/traefik.log

accessLog:
  filePath: /var/log/traefik/access.log
`;
}

/** docker-compose.yml do serviço Traefik gerenciado pelo Velix. */
export function renderComposeFile(): string {
  return `services:
  traefik:
    image: ${TRAEFIK_IMAGE}
    container_name: ${TRAEFIK_CONTAINER}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      - CF_DNS_API_TOKEN=\${CF_DNS_API_TOKEN}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ${TRAEFIK_DIR}/traefik.yml:/etc/traefik/traefik.yml:ro
      - ${TRAEFIK_DYNAMIC_DIR}:/etc/traefik/dynamic
      - ${TRAEFIK_CERTS_DIR}:/etc/traefik/certs
      - ${TRAEFIK_LOGS_DIR}:/var/log/traefik
    networks:
      - ${PROXY_NETWORK}

networks:
  ${PROXY_NETWORK}:
    external: true
`;
}

/** Arquivo dinâmico de um domínio (dynamic/<domainId>.yml). Nesta fase o alvo é
 * uma porta já publicada no host (host.docker.internal); quando o módulo
 * Aplicações existir, vira o nome do container na rede velix-proxy. */
export function renderDynamicRoute(opts: { name: string; hostname: string; targetPort: number }): string {
  return `http:
  routers:
    ${opts.name}:
      rule: "Host(\`${opts.hostname}\`)"
      entryPoints:
        - websecure
      service: ${opts.name}
      tls:
        certResolver: velix-le
  services:
    ${opts.name}:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:${opts.targetPort}"
`;
}

/** Arquivo dinâmico de domínio vinculado a uma aplicação implantada pelo Velix —
 * roteia direto pro nome do container na rede velix-proxy (os dois estão na
 * mesma rede Docker), em vez de host.docker.internal. */
export function renderDynamicRouteToContainer(opts: { name: string; hostname: string; containerName: string; containerPort: number }): string {
  return `http:
  routers:
    ${opts.name}:
      rule: "Host(\`${opts.hostname}\`)"
      entryPoints:
        - websecure
      service: ${opts.name}
      tls:
        certResolver: velix-le
  services:
    ${opts.name}:
      loadBalancer:
        servers:
          - url: "http://${opts.containerName}:${opts.containerPort}"
`;
}

/** Extrai a versão do output de `traefik version` (ex.: "Version: 3.3.1"). */
export function parseTraefikVersion(output: string): string | null {
  const match = output.match(/Version:\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i);
  return match ? match[1] : null;
}

/** Container do Traefik está rodando? (saída de `docker ps --filter ... --format '{{.Status}}'`) */
export function isContainerUp(statusOutput: string): boolean {
  return statusOutput.toLowerCase().includes('up');
}
