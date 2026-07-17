import type { VelixManifest } from '../catalog.util';

export const ghostManifest: VelixManifest = {
  slug: 'ghost',
  name: 'Ghost',
  description: 'Plataforma de publicação e newsletter, com banco MySQL dedicado.',
  category: 'cms',
  version: '5',
  icon: '/app-icons/ghost.svg',
  author: 'Velix Official',
  documentationUrl: 'https://ghost.org/docs/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 2368,
  secrets: [{ key: 'DB_ROOT_PASSWORD' }, { key: 'DB_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mysql:8.4',
      environment: {
        MYSQL_ROOT_PASSWORD: '{{secret:DB_ROOT_PASSWORD}}',
        MYSQL_DATABASE: 'ghost',
        MYSQL_USER: 'ghost',
        MYSQL_PASSWORD: '{{secret:DB_PASSWORD}}',
      },
      volumes: [{ name: 'db-data', containerPath: '/var/lib/mysql' }],
    },
    {
      name: 'app',
      image: 'ghost:5',
      environment: {
        database__client: 'mysql',
        database__connection__host: '{{service:db}}',
        database__connection__user: 'ghost',
        database__connection__password: '{{secret:DB_PASSWORD}}',
        database__connection__database: 'ghost',
        url: '{{var:SITE_URL}}',
      },
      variables: [
        {
          key: 'SITE_URL',
          label: 'URL do site',
          description: 'Endereço público final (ex.: https://blog.seudominio.com) — ajuste após associar o domínio.',
          type: 'text',
          default: 'http://localhost:2368',
          required: true,
        },
      ],
      volumes: [{ name: 'content', containerPath: '/var/lib/ghost/content' }],
      ports: [{ port: 2368, recommended: true }],
    },
  ],
};
