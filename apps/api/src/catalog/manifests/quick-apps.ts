import type { VelixManifest } from '../catalog.util';

/**
 * Aplicações de container único (ou quase) descritas como dados, não como um
 * arquivo por app. Os 26 manifestos originais são arquivos próprios porque
 * cada um tem banco dedicado, segredos e variáveis — aqui o padrão é sempre o
 * mesmo (imagem + porta + volumes + env fixo), e repetir 85 vezes a mesma
 * estrutura de objeto seria só ruído. App novo desta classe = uma linha.
 *
 * Ícones vêm do projeto selfh.st/icons via jsDelivr: são centenas de logos que
 * não valem a pena versionar aqui. O AppIcon do frontend já cai no ícone
 * genérico quando a URL falha, então nada quebra offline — só fica sem logo.
 * Para fixar um logo local, salve em apps/web/public/app-icons/<slug>.svg e
 * troque o campo `icon` desta tabela.
 */
interface QuickApp {
  slug: string;
  name: string;
  description: string;
  category: string;
  /** Sempre com tag fixa — `latest` vira alerta de segurança no scan do catálogo. */
  image: string;
  port: number;
  memoryMb?: number;
  /** [nome lógico do volume, caminho dentro do container] */
  volumes?: [string, string][];
  environment?: Record<string, string>;
  command?: string;
  docs?: string;
  /** Site oficial, quando a documentação não é o site do projeto. */
  site?: string;
  /** Repositório, quando `docs` não aponta para ele. */
  repo?: string;
  /** Capturas de tela publicadas pelo próprio projeto (README, site oficial).
   * Só URLs reais e verificadas — imagem quebrada na loja é pior que nenhuma. */
  screenshots?: string[];
  /** Nome do arquivo em selfh.st/icons quando difere do slug. */
  icon?: string;
  /** Precisa do socket do Docker (o scan de segurança marca como risco médio). */
  dockerSocket?: boolean;
}

const REPO_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org'];

function isRepoUrl(url?: string): boolean {
  if (!url) return false;
  return REPO_HOSTS.some((host) => url.includes(`${host}/`));
}

function build(app: QuickApp): VelixManifest {
  return {
    slug: app.slug,
    name: app.name,
    description: app.description,
    category: app.category,
    version: app.image.split(':').pop() ?? 'latest',
    icon: `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${app.icon ?? app.slug}.svg`,
    author: 'Velix Official',
    documentationUrl: app.docs,
    // A maioria dos `docs` já aponta pro repositório — derivar evita repetir a
    // mesma URL em duas propriedades em 115 linhas de tabela.
    repositoryUrl: app.repo ?? (isRepoUrl(app.docs) ? app.docs : undefined),
    websiteUrl: app.site,
    ...(app.screenshots?.length ? { screenshots: app.screenshots } : {}),
    minResources: { memoryMb: app.memoryMb ?? 256 },
    primaryService: 'app',
    primaryPort: app.port,
    services: [
      {
        name: 'app',
        image: app.image,
        ...(app.environment ? { environment: app.environment } : {}),
        ...(app.command ? { command: app.command } : {}),
        ...(app.dockerSocket ? { dockerSocket: true } : {}),
        volumes: (app.volumes ?? []).map(([name, containerPath]) => ({ name, containerPath })),
        ports: [{ port: app.port, recommended: true }],
      },
    ],
  };
}

const APPS: QuickApp[] = [
  // ── Painéis e gestão de containers ────────────────────────────────────────
  { slug: 'portainer', name: 'Portainer', description: 'Painel de gerenciamento de containers Docker.', category: 'development', image: 'portainer/portainer-ce:2.34.0', port: 9000, memoryMb: 256, volumes: [['data', '/data']], dockerSocket: true, docs: 'https://docs.portainer.io' },
  { slug: 'dockge', name: 'Dockge', description: 'Gerenciador visual de stacks docker compose, do autor do Uptime Kuma.', category: 'development', image: 'louislam/dockge:1.5.0', port: 5001, volumes: [['data', '/app/data']], dockerSocket: true, docs: 'https://github.com/louislam/dockge' },
  { slug: 'homepage', name: 'Homepage', description: 'Painel inicial configurável com widgets de serviços e servidores.', category: 'productivity', image: 'ghcr.io/gethomepage/homepage:v1.5.0', port: 3000, volumes: [['config', '/app/config']], dockerSocket: true, docs: 'https://gethomepage.dev' },
  { slug: 'glance', name: 'Glance', description: 'Dashboard leve que reúne feeds, métricas e status num só lugar.', category: 'productivity', image: 'glanceapp/glance:v0.9.0', port: 8080, volumes: [['config', '/app/config']], docs: 'https://github.com/glanceapp/glance' },
  { slug: 'heimdall', name: 'Heimdall', description: 'Página inicial com atalhos para todas as suas aplicações.', category: 'productivity', image: 'lscr.io/linuxserver/heimdall:2.6.3', port: 80, volumes: [['config', '/config']], docs: 'https://github.com/linuxserver/Heimdall' },
  { slug: 'dashy', name: 'Dashy', description: 'Dashboard personalizável com verificação de status integrada.', category: 'productivity', image: 'lissy93/dashy:3.1.1', port: 8080, volumes: [['config', '/app/user-data']], docs: 'https://dashy.to' },

  // ── Monitoramento ─────────────────────────────────────────────────────────
  { slug: 'beszel', name: 'Beszel', description: 'Monitor de servidores leve, com histórico de CPU, memória e disco.', category: 'monitoring', image: 'henrygd/beszel:0.14.0', port: 8090, volumes: [['data', '/beszel_data']], docs: 'https://beszel.dev' },
  { slug: 'netdata', name: 'Netdata', description: 'Métricas do sistema em tempo real, com resolução de um segundo.', category: 'monitoring', image: 'netdata/netdata:v2.3.0', port: 19999, memoryMb: 512, volumes: [['config', '/etc/netdata'], ['lib', '/var/lib/netdata'], ['cache', '/var/cache/netdata']], dockerSocket: true, docs: 'https://learn.netdata.cloud' },
  { slug: 'glances', name: 'Glances', description: 'Monitor de recursos do sistema com interface web.', category: 'monitoring', image: 'nicolargo/glances:4.3.0.8-full', port: 61208, environment: { GLANCES_OPT: '-w' }, dockerSocket: true, docs: 'https://nicolargo.github.io/glances/' },
  { slug: 'cadvisor', name: 'cAdvisor', description: 'Métricas de uso de recursos por container, exportadas para Prometheus.', category: 'monitoring', image: 'gcr.io/cadvisor/cadvisor:v0.52.1', port: 8080, dockerSocket: true, docs: 'https://github.com/google/cadvisor' },
  { slug: 'loki', name: 'Loki', description: 'Agregador de logs da Grafana, consultável por labels.', category: 'monitoring', image: 'grafana/loki:3.4.2', port: 3100, memoryMb: 512, volumes: [['data', '/loki']], docs: 'https://grafana.com/docs/loki/' },
  { slug: 'healthchecks', name: 'Healthchecks', description: 'Monitoramento de cron jobs e tarefas agendadas por ping.', category: 'monitoring', image: 'healthchecks/healthchecks:v3.10', port: 8000, volumes: [['data', '/data']], docs: 'https://healthchecks.io/docs/' },
  { slug: 'gatus', name: 'Gatus', description: 'Painel de status e alertas para endpoints HTTP, TCP e DNS.', category: 'monitoring', image: 'twinproduction/gatus:v5.16.0', port: 8080, volumes: [['config', '/config']], docs: 'https://gatus.io' },
  { slug: 'metabase', name: 'Metabase', description: 'Business intelligence com consultas visuais e painéis compartilháveis.', category: 'monitoring', image: 'metabase/metabase:v0.53.8', port: 3000, memoryMb: 1024, volumes: [['data', '/metabase-data']], environment: { MB_DB_FILE: '/metabase-data/metabase.db' }, docs: 'https://www.metabase.com/docs/' },

  // ── Bancos de dados e ferramentas ─────────────────────────────────────────
  { slug: 'influxdb', name: 'InfluxDB', description: 'Banco de séries temporais para métricas e telemetria.', category: 'database', image: 'influxdb:2.7-alpine', port: 8086, memoryMb: 512, volumes: [['data', '/var/lib/influxdb2']], docs: 'https://docs.influxdata.com/influxdb/' },
  { slug: 'clickhouse', name: 'ClickHouse', description: 'Banco colunar para análise de grandes volumes de dados.', category: 'database', image: 'clickhouse/clickhouse-server:25.3', port: 8123, memoryMb: 2048, volumes: [['data', '/var/lib/clickhouse']], docs: 'https://clickhouse.com/docs' },
  { slug: 'couchdb', name: 'CouchDB', description: 'Banco de documentos com replicação nativa e API HTTP.', category: 'database', image: 'couchdb:3.4', port: 5984, volumes: [['data', '/opt/couchdb/data']], docs: 'https://docs.couchdb.org' },
  { slug: 'neo4j', name: 'Neo4j', description: 'Banco de grafos com linguagem de consulta Cypher.', category: 'database', image: 'neo4j:5.26', port: 7474, memoryMb: 1024, volumes: [['data', '/data']], docs: 'https://neo4j.com/docs/' },
  { slug: 'valkey', name: 'Valkey', description: 'Fork open source do Redis, compatível com o mesmo protocolo.', category: 'database', image: 'valkey/valkey:8-alpine', port: 6379, volumes: [['data', '/data']], docs: 'https://valkey.io' },
  { slug: 'memcached', name: 'Memcached', description: 'Cache de objetos em memória, simples e muito rápido.', category: 'database', image: 'memcached:1.6-alpine', port: 11211, docs: 'https://memcached.org' },
  { slug: 'rabbitmq', name: 'RabbitMQ', description: 'Broker de mensagens AMQP com painel de administração.', category: 'database', image: 'rabbitmq:4-management-alpine', port: 15672, memoryMb: 512, volumes: [['data', '/var/lib/rabbitmq']], docs: 'https://www.rabbitmq.com/docs' },
  { slug: 'qdrant', name: 'Qdrant', description: 'Banco vetorial para busca semântica e aplicações de IA.', category: 'ai', image: 'qdrant/qdrant:v1.13.4', port: 6333, memoryMb: 512, volumes: [['storage', '/qdrant/storage']], docs: 'https://qdrant.tech/documentation/' },
  { slug: 'chroma', name: 'Chroma', description: 'Banco de embeddings para RAG e memória de agentes.', category: 'ai', image: 'chromadb/chroma:0.6.3', port: 8000, volumes: [['data', '/chroma/chroma']], docs: 'https://docs.trychroma.com' },
  { slug: 'adminer', name: 'Adminer', description: 'Administração de bancos SQL num único arquivo PHP.', category: 'database', image: 'adminer:5.1.0', port: 8080, memoryMb: 128, docs: 'https://www.adminer.org' },
  { slug: 'pgadmin', name: 'pgAdmin', description: 'Interface web oficial de administração do PostgreSQL.', category: 'database', image: 'dpage/pgadmin4:9.1', port: 80, memoryMb: 512, environment: { PGADMIN_DEFAULT_EMAIL: 'admin@velix.local', PGADMIN_DEFAULT_PASSWORD: 'changeme' }, volumes: [['data', '/var/lib/pgadmin']], docs: 'https://www.pgadmin.org/docs/' },
  { slug: 'phpmyadmin', name: 'phpMyAdmin', description: 'Administração web de bancos MySQL e MariaDB.', category: 'database', image: 'phpmyadmin:5.2', port: 80, docs: 'https://www.phpmyadmin.net' },
  { slug: 'mongo-express', name: 'Mongo Express', description: 'Interface web para inspecionar e editar bancos MongoDB.', category: 'database', image: 'mongo-express:1.0.2', port: 8081, icon: 'mongodb', docs: 'https://github.com/mongo-express/mongo-express' },
  { slug: 'redisinsight', name: 'RedisInsight', description: 'Cliente visual oficial para inspecionar bancos Redis.', category: 'database', image: 'redis/redisinsight:2.66', port: 5540, volumes: [['data', '/data']], icon: 'redis', docs: 'https://redis.io/docs/latest/operate/redisinsight/' },
  { slug: 'nocodb', name: 'NocoDB', description: 'Planilha colaborativa sobre banco relacional, alternativa ao Airtable.', category: 'productivity', image: 'nocodb/nocodb:0.263.6', port: 8080, memoryMb: 1024, volumes: [['data', '/usr/app/data']], docs: 'https://docs.nocodb.com' },
  { slug: 'baserow', name: 'Baserow', description: 'Banco de dados sem código com interface de planilha.', category: 'productivity', image: 'baserow/baserow:1.31.1', port: 80, memoryMb: 2048, volumes: [['data', '/baserow/data']], docs: 'https://baserow.io/docs' },
  { slug: 'directus', name: 'Directus', description: 'CMS headless e painel de dados sobre banco SQL existente.', category: 'cms', image: 'directus/directus:11.5.1', port: 8055, memoryMb: 1024, volumes: [['database', '/directus/database'], ['uploads', '/directus/uploads']], docs: 'https://docs.directus.io' },
  { slug: 'pocketbase', name: 'PocketBase', description: 'Backend completo num binário: banco, autenticação e API REST.', category: 'development', image: 'ghcr.io/muchobien/pocketbase:0.25.9', port: 8090, memoryMb: 128, volumes: [['data', '/pb_data']], docs: 'https://pocketbase.io/docs/' },

  // ── Desenvolvimento ───────────────────────────────────────────────────────
  { slug: 'forgejo', name: 'Forgejo', description: 'Forge Git self-hosted, fork comunitário do Gitea.', category: 'development', image: 'codeberg.org/forgejo/forgejo:11', port: 3000, memoryMb: 512, volumes: [['data', '/data']], docs: 'https://forgejo.org/docs/latest/' },
  { slug: 'gitlab', name: 'GitLab CE', description: 'Plataforma DevOps completa: Git, CI/CD, registry e issues.', category: 'development', image: 'gitlab/gitlab-ce:17.9.1-ce.0', port: 80, memoryMb: 4096, volumes: [['config', '/etc/gitlab'], ['logs', '/var/log/gitlab'], ['data', '/var/opt/gitlab']], docs: 'https://docs.gitlab.com' },
  { slug: 'jenkins', name: 'Jenkins', description: 'Servidor de automação e integração contínua com milhares de plugins.', category: 'development', image: 'jenkins/jenkins:2.492.1-lts', port: 8080, memoryMb: 1024, volumes: [['home', '/var/jenkins_home']], docs: 'https://www.jenkins.io/doc/' },
  { slug: 'woodpecker', name: 'Woodpecker CI', description: 'Servidor de CI leve baseado em containers, integrado a forges Git.', category: 'development', image: 'woodpeckerci/woodpecker-server:v3.1.0', port: 8000, volumes: [['data', '/var/lib/woodpecker']], docs: 'https://woodpecker-ci.org/docs/intro' },
  { slug: 'sonarqube', name: 'SonarQube', description: 'Análise estática de código com métricas de qualidade e segurança.', category: 'development', image: 'sonarqube:25.2-community', port: 9000, memoryMb: 2048, volumes: [['data', '/opt/sonarqube/data'], ['extensions', '/opt/sonarqube/extensions']], docs: 'https://docs.sonarsource.com/sonarqube/' },
  { slug: 'nexus', name: 'Nexus Repository', description: 'Repositório de artefatos para npm, Maven, Docker e mais.', category: 'development', image: 'sonatype/nexus3:3.78.0', port: 8081, memoryMb: 2048, volumes: [['data', '/nexus-data']], docs: 'https://help.sonatype.com/en/sonatype-nexus-repository.html' },
  { slug: 'verdaccio', name: 'Verdaccio', description: 'Registro npm privado com cache do registro público.', category: 'development', image: 'verdaccio/verdaccio:6', port: 4873, volumes: [['storage', '/verdaccio/storage']], docs: 'https://verdaccio.org/docs/what-is-verdaccio' },
  { slug: 'docker-registry', name: 'Docker Registry', description: 'Registro privado de imagens Docker.', category: 'development', image: 'registry:2.8.3', port: 5000, volumes: [['data', '/var/lib/registry']], icon: 'docker', docs: 'https://distribution.github.io/distribution/' },
  { slug: 'code-server', name: 'code-server', description: 'VS Code rodando no servidor, acessível pelo navegador.', category: 'development', image: 'lscr.io/linuxserver/code-server:4.97.2', port: 8443, memoryMb: 1024, volumes: [['config', '/config']], docs: 'https://coder.com/docs/code-server' },
  { slug: 'gitea-act-runner', name: 'Gitea Act Runner', description: 'Executor de workflows do Gitea Actions.', category: 'development', image: 'gitea/act_runner:0.2.11', port: 8088, volumes: [['data', '/data']], dockerSocket: true, icon: 'gitea', docs: 'https://docs.gitea.com/usage/actions/act-runner' },
  { slug: 'swagger-ui', name: 'Swagger UI', description: 'Documentação interativa para APIs OpenAPI.', category: 'development', image: 'swaggerapi/swagger-ui:v5.20.0', port: 8080, memoryMb: 128, docs: 'https://swagger.io/tools/swagger-ui/' },
  { slug: 'mailpit', name: 'Mailpit', description: 'Servidor SMTP de testes com caixa de entrada web.', category: 'development', image: 'axllent/mailpit:v1.22.3', port: 8025, memoryMb: 128, volumes: [['data', '/data']], docs: 'https://mailpit.axllent.org' },
  { slug: 'wiremock', name: 'WireMock', description: 'Simulador de APIs HTTP para testes de integração.', category: 'development', image: 'wiremock/wiremock:3.12.1', port: 8080, docs: 'https://wiremock.org/docs/' },

  // ── Automação e mensageria ────────────────────────────────────────────────
  { slug: 'gotify', name: 'Gotify', description: 'Servidor de notificações push self-hosted com API simples.', category: 'automation', image: 'gotify/server:2.6.1', port: 80, memoryMb: 128, volumes: [['data', '/app/data']], docs: 'https://gotify.net/docs/' },
  { slug: 'ntfy', name: 'ntfy', description: 'Notificações push por HTTP, sem cadastro e com apps nativos.', category: 'automation', image: 'binwiederhier/ntfy:v2.11.0', port: 80, memoryMb: 128, command: 'serve', volumes: [['cache', '/var/cache/ntfy'], ['etc', '/etc/ntfy']], docs: 'https://docs.ntfy.sh' },
  { slug: 'apprise', name: 'Apprise API', description: 'Uma API para enviar notificações a mais de 80 serviços.', category: 'automation', image: 'caronc/apprise:1.2.0', port: 8000, volumes: [['config', '/config']], docs: 'https://github.com/caronc/apprise-api' },
  { slug: 'changedetection', name: 'Change Detection', description: 'Monitora páginas web e avisa quando o conteúdo muda.', category: 'automation', image: 'ghcr.io/dgtlmoon/changedetection.io:0.49.4', port: 5000, volumes: [['data', '/datastore']], docs: 'https://changedetection.io' },
  { slug: 'mosquitto', name: 'Mosquitto', description: 'Broker MQTT leve, base de quase toda automação residencial.', category: 'automation', image: 'eclipse-mosquitto:2.0.20', port: 1883, memoryMb: 128, volumes: [['config', '/mosquitto/config'], ['data', '/mosquitto/data']], docs: 'https://mosquitto.org/documentation/' },
  { slug: 'esphome', name: 'ESPHome', description: 'Configura e atualiza dispositivos ESP32/ESP8266 por YAML.', category: 'automation', image: 'ghcr.io/esphome/esphome:2025.2.1', port: 6052, volumes: [['config', '/config']], docs: 'https://esphome.io' },
  { slug: 'zigbee2mqtt', name: 'Zigbee2MQTT', description: 'Ponte entre dispositivos Zigbee e MQTT, sem hub do fabricante.', category: 'automation', image: 'koenkk/zigbee2mqtt:2.1.3', port: 8080, volumes: [['data', '/app/data']], docs: 'https://www.zigbee2mqtt.io' },

  // ── Rede e segurança ──────────────────────────────────────────────────────
  { slug: 'adguard-home', name: 'AdGuard Home', description: 'Servidor DNS com bloqueio de anúncios e rastreadores na rede toda.', category: 'network', image: 'adguard/adguardhome:v0.107.68', port: 3000, volumes: [['work', '/opt/adguardhome/work'], ['conf', '/opt/adguardhome/conf']], icon: 'adguard-home', docs: 'https://github.com/AdguardTeam/AdGuardHome/wiki' },
  { slug: 'pihole', name: 'Pi-hole', description: 'Bloqueio de anúncios em nível de DNS, com painel de estatísticas.', category: 'network', image: 'pihole/pihole:2025.08.0', port: 80, environment: { TZ: 'America/Sao_Paulo', FTLCONF_webserver_api_password: 'changeme' }, volumes: [['etc', '/etc/pihole']], icon: 'pi-hole', docs: 'https://docs.pi-hole.net' },
  { slug: 'technitium-dns', name: 'Technitium DNS', description: 'Servidor DNS autoritativo e recursivo com painel completo.', category: 'network', image: 'technitium/dns-server:13.4.3', port: 5380, volumes: [['config', '/etc/dns']], icon: 'technitium-dns-server', docs: 'https://technitium.com/dns/' },
  { slug: 'nginx-proxy-manager', name: 'Nginx Proxy Manager', description: 'Proxy reverso com interface visual e SSL Let’s Encrypt.', category: 'network', image: 'jc21/nginx-proxy-manager:2.12.3', port: 81, volumes: [['data', '/data'], ['letsencrypt', '/etc/letsencrypt']], docs: 'https://nginxproxymanager.com/guide/' },
  { slug: 'caddy', name: 'Caddy', description: 'Servidor web e proxy reverso com HTTPS automático.', category: 'network', image: 'caddy:2.9-alpine', port: 80, memoryMb: 128, volumes: [['data', '/data'], ['config', '/config']], docs: 'https://caddyserver.com/docs/' },
  { slug: 'nginx', name: 'Nginx', description: 'Servidor web e proxy reverso de alta performance.', category: 'network', image: 'nginx:1.27-alpine', port: 80, memoryMb: 128, volumes: [['html', '/usr/share/nginx/html']], docs: 'https://nginx.org/en/docs/' },
  { slug: 'haproxy', name: 'HAProxy', description: 'Balanceador de carga TCP e HTTP usado em larga escala.', category: 'network', image: 'haproxy:3.1-alpine', port: 80, memoryMb: 128, docs: 'https://www.haproxy.org/#docs' },
  { slug: 'searxng', name: 'SearXNG', description: 'Metabuscador que não rastreia e agrega dezenas de fontes.', category: 'network', image: 'searxng/searxng:2025.2.20', port: 8080, volumes: [['config', '/etc/searxng']], docs: 'https://docs.searxng.org' },
  { slug: 'librespeed', name: 'LibreSpeed', description: 'Teste de velocidade de rede self-hosted, sem Flash nem Java.', category: 'network', image: 'lscr.io/linuxserver/librespeed:5.4.1', port: 80, memoryMb: 128, docs: 'https://librespeed.org' },
  { slug: 'speedtest-tracker', name: 'Speedtest Tracker', description: 'Mede a velocidade da sua internet periodicamente e guarda o histórico.', category: 'network', image: 'lscr.io/linuxserver/speedtest-tracker:1.6.4', port: 80, volumes: [['config', '/config']], docs: 'https://docs.speedtest-tracker.dev' },
  { slug: 'flaresolverr', name: 'FlareSolverr', description: 'Resolve desafios de proxy para clientes automatizados.', category: 'network', image: 'ghcr.io/flaresolverr/flaresolverr:v3.3.21', port: 8191, memoryMb: 512, docs: 'https://github.com/FlareSolverr/FlareSolverr' },
  { slug: 'pairdrop', name: 'PairDrop', description: 'Transferência de arquivos entre dispositivos da mesma rede, pelo navegador.', category: 'network', image: 'lscr.io/linuxserver/pairdrop:1.11.2', port: 3000, memoryMb: 128, docs: 'https://github.com/schlagmichdoch/PairDrop' },
  { slug: 'pocket-id', name: 'Pocket ID', description: 'Provedor OIDC simples que autentica com passkeys.', category: 'security', image: 'ghcr.io/pocket-id/pocket-id:v1.0.0', port: 1411, volumes: [['data', '/app/data']], docs: 'https://pocket-id.org' },
  { slug: 'vault', name: 'HashiCorp Vault', description: 'Cofre de segredos com políticas, rotação e auditoria.', category: 'security', image: 'hashicorp/vault:1.18', port: 8200, volumes: [['file', '/vault/file'], ['logs', '/vault/logs']], docs: 'https://developer.hashicorp.com/vault/docs' },
  { slug: 'crowdsec', name: 'CrowdSec', description: 'Detecção de comportamento malicioso com listas de bloqueio colaborativas.', category: 'security', image: 'crowdsecurity/crowdsec:v1.6.5', port: 8080, volumes: [['config', '/etc/crowdsec'], ['data', '/var/lib/crowdsec/data']], docs: 'https://docs.crowdsec.net' },
  { slug: 'stirling-pdf', name: 'Stirling PDF', description: 'Mais de 50 operações em PDF (juntar, dividir, OCR, assinar) no navegador.', category: 'productivity', image: 'stirlingtools/stirling-pdf:1.4.0', port: 8080, memoryMb: 1024, volumes: [['data', '/usr/share/tessdata']], docs: 'https://docs.stirlingpdf.com' },

  // ── Produtividade e conhecimento ──────────────────────────────────────────
  { slug: 'memos', name: 'Memos', description: 'Notas rápidas em markdown, self-hosted e com API.', category: 'productivity', image: 'neosmemo/memos:0.24.4', port: 5230, memoryMb: 128, volumes: [['data', '/var/opt/memos']], docs: 'https://usememos.com/docs' },
  { slug: 'silverbullet', name: 'SilverBullet', description: 'Bloco de notas em markdown com wiki de links e scripts.', category: 'productivity', image: 'ghcr.io/silverbulletmd/silverbullet:0.10.4', port: 3000, memoryMb: 256, volumes: [['space', '/space']], docs: 'https://silverbullet.md' },
  { slug: 'trilium', name: 'Trilium Notes', description: 'Base de conhecimento hierárquica com notas ilimitadas.', category: 'productivity', image: 'triliumnext/notes:v0.99.1', port: 8080, volumes: [['data', '/home/node/trilium-data']], icon: 'trilium-notes', docs: 'https://triliumnext.github.io/Docs/' },
  { slug: 'vikunja', name: 'Vikunja', description: 'Gerenciador de tarefas com listas, kanban, gantt e calendário.', category: 'productivity', image: 'vikunja/vikunja:0.24.6', port: 3456, volumes: [['files', '/app/vikunja/files'], ['db', '/db']], docs: 'https://vikunja.io/docs/' },
  { slug: 'focalboard', name: 'Focalboard', description: 'Quadros kanban para projetos, alternativa ao Trello.', category: 'productivity', image: 'mattermost/focalboard:7.11.4', port: 8000, volumes: [['data', '/opt/focalboard/data']], docs: 'https://www.focalboard.com/docs/' },
  { slug: 'mealie', name: 'Mealie', description: 'Gerenciador de receitas com importação por URL e lista de compras.', category: 'productivity', image: 'ghcr.io/mealie-recipes/mealie:v3.4.0', port: 9000, memoryMb: 1024, volumes: [['data', '/app/data']], docs: 'https://docs.mealie.io' },
  { slug: 'actual-budget', name: 'Actual Budget', description: 'Orçamento pessoal por envelopes, com sincronização entre dispositivos.', category: 'productivity', image: 'ghcr.io/actualbudget/actual-server:25.7.1', port: 5006, volumes: [['data', '/data']], icon: 'actual-budget', docs: 'https://actualbudget.org/docs/' },
  { slug: 'wallos', name: 'Wallos', description: 'Controle de assinaturas recorrentes com alertas de renovação.', category: 'productivity', image: 'ghcr.io/ellite/wallos:v3.4.0', port: 80, volumes: [['db', '/var/www/html/db'], ['logos', '/var/www/html/images/uploads/logos']], docs: 'https://github.com/ellite/Wallos' },
  { slug: 'grocy', name: 'Grocy', description: 'Gestão de despensa, validade de alimentos e tarefas domésticas.', category: 'productivity', image: 'lscr.io/linuxserver/grocy:4.5.0', port: 80, volumes: [['config', '/config']], docs: 'https://grocy.info' },
  { slug: 'freshrss', name: 'FreshRSS', description: 'Leitor de feeds RSS self-hosted, leve e com extensões.', category: 'productivity', image: 'freshrss/freshrss:1.26.3', port: 80, volumes: [['data', '/var/www/FreshRSS/data']], docs: 'https://freshrss.github.io/FreshRSS/' },
  { slug: 'wallabag', name: 'Wallabag', description: 'Salva artigos para ler depois, sem anúncios nem rastreadores.', category: 'productivity', image: 'wallabag/wallabag:2.6.13', port: 80, memoryMb: 512, environment: { SYMFONY__ENV__DATABASE_DRIVER: 'pdo_sqlite' }, volumes: [['data', '/var/www/wallabag/data']], docs: 'https://doc.wallabag.org' },
  { slug: 'docuseal', name: 'DocuSeal', description: 'Assinatura eletrônica de documentos, alternativa ao DocuSign.', category: 'productivity', image: 'docuseal/docuseal:1.9.0', port: 3000, memoryMb: 512, volumes: [['data', '/data']], docs: 'https://www.docuseal.com/docs' },
  { slug: 'it-tools', name: 'IT Tools', description: 'Coleção de utilitários para desenvolvedores num só lugar.', category: 'productivity', image: 'corentinth/it-tools:4.1.0', port: 80, memoryMb: 128, docs: 'https://github.com/CorentinTh/it-tools' },
  { slug: 'drawio', name: 'draw.io', description: 'Editor de diagramas e fluxogramas no navegador.', category: 'productivity', image: 'jgraph/drawio:26.0.16', port: 8080, memoryMb: 512, docs: 'https://www.drawio.com/doc/' },
  { slug: 'pingvin-share', name: 'Pingvin Share', description: 'Compartilhamento de arquivos com links que expiram.', category: 'storage', image: 'stonith404/pingvin-share:1.11.1', port: 3000, volumes: [['data', '/opt/app/backend/data'], ['images', '/opt/app/frontend/public/img']], docs: 'https://stonith404.github.io/pingvin-share/' },

  // ── Armazenamento e arquivos ──────────────────────────────────────────────
  { slug: 'filebrowser', name: 'File Browser', description: 'Gerenciador de arquivos web para um diretório do servidor.', category: 'storage', image: 'filebrowser/filebrowser:v2.32.0', port: 80, memoryMb: 128, volumes: [['srv', '/srv'], ['database', '/database']], docs: 'https://filebrowser.org' },
  { slug: 'syncthing', name: 'Syncthing', description: 'Sincronização contínua de arquivos entre dispositivos, sem nuvem.', category: 'storage', image: 'lscr.io/linuxserver/syncthing:1.29.2', port: 8384, volumes: [['config', '/config'], ['data', '/data']], docs: 'https://docs.syncthing.net' },
  { slug: 'duplicati', name: 'Duplicati', description: 'Backups criptografados e incrementais para qualquer destino.', category: 'storage', image: 'lscr.io/linuxserver/duplicati:2.1.0', port: 8200, volumes: [['config', '/config'], ['backups', '/backups']], docs: 'https://duplicati.readthedocs.io' },
  { slug: 'garage', name: 'Garage', description: 'Armazenamento de objetos compatível com S3, leve e distribuído.', category: 'storage', image: 'dxflrs/garage:v1.1.0', port: 3900, volumes: [['meta', '/var/lib/garage/meta'], ['data', '/var/lib/garage/data']], docs: 'https://garagehq.deuxfleurs.fr/documentation/' },
  { slug: 'sftpgo', name: 'SFTPGo', description: 'Servidor SFTP, FTPS e WebDAV com painel de administração.', category: 'storage', image: 'drakkan/sftpgo:v2.6', port: 8080, volumes: [['data', '/srv/sftpgo'], ['home', '/var/lib/sftpgo']], docs: 'https://docs.sftpgo.com' },

  // ── Mídia ─────────────────────────────────────────────────────────────────
  { slug: 'plex', name: 'Plex', description: 'Servidor de mídia com apps para TV, celular e console.', category: 'media', image: 'lscr.io/linuxserver/plex:1.41.7', port: 32400, memoryMb: 1024, volumes: [['config', '/config'], ['media', '/data']], docs: 'https://support.plex.tv' },
  { slug: 'emby', name: 'Emby', description: 'Servidor de mídia pessoal com transcodificação e apps nativos.', category: 'media', image: 'emby/embyserver:4.8.11.0', port: 8096, memoryMb: 1024, volumes: [['config', '/config'], ['media', '/mnt/media']], docs: 'https://emby.media/support/' },
  { slug: 'jellyseerr', name: 'Jellyseerr', description: 'Pedidos de filmes e séries integrados ao Jellyfin e Plex.', category: 'media', image: 'fallenbagel/jellyseerr:2.5.2', port: 5055, memoryMb: 512, volumes: [['config', '/app/config']], docs: 'https://docs.jellyseerr.dev' },
  { slug: 'overseerr', name: 'Overseerr', description: 'Central de pedidos de mídia para bibliotecas Plex.', category: 'media', image: 'sctx/overseerr:1.34.0', port: 5055, memoryMb: 512, volumes: [['config', '/app/config']], docs: 'https://docs.overseerr.dev' },
  { slug: 'radarr', name: 'Radarr', description: 'Gerenciamento e organização automática da biblioteca de filmes.', category: 'media', image: 'lscr.io/linuxserver/radarr:5.19.3', port: 7878, volumes: [['config', '/config'], ['movies', '/movies']], docs: 'https://wiki.servarr.com/radarr' },
  { slug: 'sonarr', name: 'Sonarr', description: 'Gerenciamento e organização automática de séries.', category: 'media', image: 'lscr.io/linuxserver/sonarr:4.0.14', port: 8989, volumes: [['config', '/config'], ['tv', '/tv']], docs: 'https://wiki.servarr.com/sonarr' },
  { slug: 'lidarr', name: 'Lidarr', description: 'Gerenciamento automático da biblioteca de música.', category: 'media', image: 'lscr.io/linuxserver/lidarr:2.9.6', port: 8686, volumes: [['config', '/config'], ['music', '/music']], docs: 'https://wiki.servarr.com/lidarr' },
  { slug: 'prowlarr', name: 'Prowlarr', description: 'Gerenciador central de indexadores para o conjunto *arr.', category: 'media', image: 'lscr.io/linuxserver/prowlarr:1.32.2', port: 9696, volumes: [['config', '/config']], docs: 'https://wiki.servarr.com/prowlarr' },
  { slug: 'bazarr', name: 'Bazarr', description: 'Busca e sincroniza legendas para filmes e séries.', category: 'media', image: 'lscr.io/linuxserver/bazarr:1.5.1', port: 6767, volumes: [['config', '/config']], docs: 'https://wiki.bazarr.media' },
  { slug: 'tautulli', name: 'Tautulli', description: 'Estatísticas de uso e histórico de reprodução do Plex.', category: 'media', image: 'tautulli/tautulli:v2.15.1', port: 8181, volumes: [['config', '/config']], docs: 'https://github.com/Tautulli/Tautulli/wiki' },
  { slug: 'calibre-web', name: 'Calibre-Web', description: 'Biblioteca de e-books com leitor no navegador e envio para Kindle.', category: 'media', image: 'lscr.io/linuxserver/calibre-web:0.6.24', port: 8083, volumes: [['config', '/config'], ['books', '/books']], docs: 'https://github.com/janeczku/calibre-web/wiki' },
  { slug: 'kavita', name: 'Kavita', description: 'Servidor de leitura para mangás, quadrinhos e e-books.', category: 'media', image: 'jvmilazz0/kavita:0.8.6', port: 5000, volumes: [['config', '/kavita/config'], ['data', '/data']], docs: 'https://wiki.kavitareader.com' },
  { slug: 'komga', name: 'Komga', description: 'Servidor de quadrinhos e mangás com API e apps compatíveis.', category: 'media', image: 'gotson/komga:1.19.1', port: 25600, memoryMb: 512, volumes: [['config', '/config'], ['data', '/data']], docs: 'https://komga.org/docs/' },
  { slug: 'lychee', name: 'Lychee', description: 'Galeria de fotos self-hosted, rápida e com álbuns compartilháveis.', category: 'media', image: 'lycheeorg/lychee:v6.6.4', port: 80, memoryMb: 512, volumes: [['config', '/conf'], ['uploads', '/uploads']], docs: 'https://lycheeorg.github.io/docs/' },
  { slug: 'piwigo', name: 'Piwigo', description: 'Gerenciador de galerias de fotos com álbuns, tags e permissões.', category: 'media', image: 'lscr.io/linuxserver/piwigo:15.5.0', port: 80, volumes: [['config', '/config']], docs: 'https://piwigo.org/doc/' },
  { slug: 'transmission', name: 'Transmission', description: 'Cliente BitTorrent leve com interface web.', category: 'media', image: 'lscr.io/linuxserver/transmission:4.0.6', port: 9091, volumes: [['config', '/config'], ['downloads', '/downloads']], docs: 'https://transmissionbt.com' },
  { slug: 'deluge', name: 'Deluge', description: 'Cliente BitTorrent com plugins e controle remoto.', category: 'media', image: 'lscr.io/linuxserver/deluge:2.1.1', port: 8112, volumes: [['config', '/config'], ['downloads', '/downloads']], docs: 'https://deluge-torrent.org' },
  { slug: 'sabnzbd', name: 'SABnzbd', description: 'Cliente Usenet com download e pós-processamento automáticos.', category: 'media', image: 'lscr.io/linuxserver/sabnzbd:4.4.1', port: 8080, volumes: [['config', '/config'], ['downloads', '/downloads']], docs: 'https://sabnzbd.org/wiki/' },
  { slug: 'metube', name: 'MeTube', description: 'Interface web para baixar vídeos via yt-dlp.', category: 'media', image: 'ghcr.io/alexta69/metube:2025-02-19', port: 8081, volumes: [['downloads', '/downloads']], docs: 'https://github.com/alexta69/metube' },

  // ── Inteligência artificial ───────────────────────────────────────────────
  { slug: 'localai', name: 'LocalAI', description: 'API compatível com OpenAI rodando modelos locais em CPU ou GPU.', category: 'ai', image: 'localai/localai:v2.26.0', port: 8080, memoryMb: 4096, volumes: [['models', '/build/models']], docs: 'https://localai.io/basics/getting_started/' },
  { slug: 'anythingllm', name: 'AnythingLLM', description: 'Chat com seus documentos, com RAG e múltiplos provedores.', category: 'ai', image: 'mintplexlabs/anythingllm:1.7.5', port: 3001, memoryMb: 2048, volumes: [['storage', '/app/server/storage']], docs: 'https://docs.anythingllm.com' },
  { slug: 'flowise', name: 'Flowise', description: 'Construtor visual de fluxos e agentes de LLM.', category: 'ai', image: 'flowiseai/flowise:2.2.6', port: 3000, memoryMb: 1024, volumes: [['data', '/root/.flowise']], docs: 'https://docs.flowiseai.com' },
  { slug: 'langflow', name: 'Langflow', description: 'Editor visual de pipelines de IA, com exportação para API.', category: 'ai', image: 'langflowai/langflow:1.1.4', port: 7860, memoryMb: 2048, volumes: [['data', '/app/langflow']], docs: 'https://docs.langflow.org' },
  { slug: 'whisper-asr', name: 'Whisper ASR', description: 'Transcrição e tradução de áudio por API, baseada no Whisper.', category: 'ai', image: 'onerahmet/openai-whisper-asr-webservice:v1.8.0', port: 9000, memoryMb: 4096, volumes: [['cache', '/root/.cache']], icon: 'openai', docs: 'https://github.com/ahmetoner/whisper-asr-webservice' },
  { slug: 'librechat', name: 'LibreChat', description: 'Interface de chat multi-modelo com histórico e plugins.', category: 'ai', image: 'ghcr.io/danny-avila/librechat:v0.7.7', port: 3080, memoryMb: 1024, volumes: [['images', '/app/client/public/images']], docs: 'https://www.librechat.ai/docs' },

  // ── Jogos ─────────────────────────────────────────────────────────────────
  { slug: 'minecraft-server', name: 'Minecraft Server', description: 'Servidor Minecraft Java com mods e plugins opcionais.', category: 'games', image: 'itzg/minecraft-server:2025.2.1', port: 25565, memoryMb: 2048, environment: { EULA: 'TRUE' }, volumes: [['data', '/data']], icon: 'minecraft', docs: 'https://docker-minecraft-server.readthedocs.io' },
  { slug: 'romm', name: 'RomM', description: 'Biblioteca de ROMs de videogame com metadados e player web.', category: 'games', image: 'rommapp/romm:3.9.0', port: 8080, memoryMb: 1024, volumes: [['resources', '/romm/resources'], ['library', '/romm/library']], docs: 'https://docs.romm.app' },
];

export const QUICK_MANIFESTS: VelixManifest[] = APPS.map(build);
