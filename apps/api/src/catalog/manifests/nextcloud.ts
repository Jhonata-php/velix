import type { VelixManifest } from '../catalog.util';

export const nextcloudManifest: VelixManifest = {
  slug: 'nextcloud',
  name: 'Nextcloud',
  description: 'Armazenamento de arquivos e colaboração self-hosted, com banco, cache e tarefas agendadas.',
  category: 'productivity',
  version: '29',
  icon: '/app-icons/nextcloud.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.nextcloud.com/',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 80,
  secrets: [{ key: 'DB_ROOT_PASSWORD' }, { key: 'DB_PASSWORD' }, { key: 'ADMIN_PASSWORD' }, { key: 'ONLYOFFICE_JWT_SECRET' }],
  services: [
    {
      name: 'db',
      image: 'mariadb:11.4',
      environment: {
        MARIADB_ROOT_PASSWORD: '{{secret:DB_ROOT_PASSWORD}}',
        MARIADB_DATABASE: 'nextcloud',
        MARIADB_USER: 'nextcloud',
        MARIADB_PASSWORD: '{{secret:DB_PASSWORD}}',
      },
      volumes: [{ name: 'db-data', containerPath: '/var/lib/mysql' }],
    },
    {
      name: 'redis',
      image: 'redis:7.4',
      volumes: [{ name: 'redis-data', containerPath: '/data' }],
    },
    {
      name: 'app',
      image: 'nextcloud:29-apache',
      dependsOn: ['db', 'redis'],
      environment: {
        MYSQL_HOST: '{{service:db}}',
        MYSQL_DATABASE: 'nextcloud',
        MYSQL_USER: 'nextcloud',
        MYSQL_PASSWORD: '{{secret:DB_PASSWORD}}',
        NEXTCLOUD_ADMIN_USER: '{{var:ADMIN_USER}}',
        NEXTCLOUD_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}',
        REDIS_HOST: '{{service:redis}}',
      },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true }],
      volumes: [{ name: 'app-data', containerPath: '/var/www/html' }],
      ports: [{ port: 80, recommended: true }],
    },
    {
      // ponytail: mesma imagem do app rodando o script de cron embutido do
      // Nextcloud (`/cron.sh`, executa `cron.php` em loop) — compartilha o
      // volume `app-data` com o serviço `app` (mesmo nome de volume nos dois).
      name: 'cron',
      image: 'nextcloud:29-apache',
      command: '/cron.sh',
      dependsOn: ['db', 'redis'],
      volumes: [{ name: 'app-data', containerPath: '/var/www/html' }],
    },
    {
      // ponytail: sobe o container e expõe a API, mas conectar o OnlyOffice
      // dentro do Nextcloud (app "Escritórios ONLYOFFICE") ainda é um passo
      // manual no admin do Nextcloud — o Velix não roda comandos `occ`.
      name: 'onlyoffice',
      image: 'onlyoffice/documentserver:8.3',
      optional: true,
      environment: {
        JWT_ENABLED: 'true',
        JWT_SECRET: '{{secret:ONLYOFFICE_JWT_SECRET}}',
      },
      volumes: [
        { name: 'onlyoffice-data', containerPath: '/var/www/onlyoffice/Data' },
        { name: 'onlyoffice-logs', containerPath: '/var/log/onlyoffice' },
      ],
      ports: [{ port: 80, recommended: true }],
    },
  ],
};
