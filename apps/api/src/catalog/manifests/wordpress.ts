import type { VelixManifest } from '../catalog.util';

/** Primeiro manifesto multi-serviço do catálogo — prova a referência entre
 * serviços (`{{service:db}}`) e mais de um segredo no mesmo deploy. O
 * entrypoint oficial do WordPress já espera o MySQL ficar pronto sozinho,
 * sem precisar de healthcheck/depends_on. */
export const wordpressManifest: VelixManifest = {
  slug: 'wordpress',
  name: 'WordPress',
  description: 'CMS mais usado do mundo, pronto com banco MySQL dedicado.',
  category: 'cms',
  version: '6.7',
  icon: '/app-icons/wordpress.svg',
  author: 'Velix Official',
  documentationUrl: 'https://wordpress.org/documentation/',
  minResources: { memoryMb: 512 },
  primaryService: 'wordpress',
  primaryPort: 80,
  secrets: [{ key: 'DB_ROOT_PASSWORD' }, { key: 'DB_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mysql:8.4',
      environment: {
        MYSQL_ROOT_PASSWORD: '{{secret:DB_ROOT_PASSWORD}}',
        MYSQL_DATABASE: 'wordpress',
        MYSQL_USER: 'wordpress',
        MYSQL_PASSWORD: '{{secret:DB_PASSWORD}}',
      },
      volumes: [{ name: 'db-data', containerPath: '/var/lib/mysql' }],
    },
    {
      name: 'wordpress',
      image: 'wordpress:6.7',
      environment: {
        WORDPRESS_DB_HOST: '{{service:db}}',
        WORDPRESS_DB_USER: 'wordpress',
        WORDPRESS_DB_PASSWORD: '{{secret:DB_PASSWORD}}',
        WORDPRESS_DB_NAME: 'wordpress',
      },
      volumes: [{ name: 'wp-data', containerPath: '/var/www/html' }],
      ports: [{ port: 80, recommended: true }],
    },
  ],
};
