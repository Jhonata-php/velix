import type { VelixManifest } from '../catalog.util';

export const mariadbManifest: VelixManifest = {
  slug: 'mariadb',
  name: 'MariaDB',
  description: 'Banco de dados relacional MariaDB, com senha root gerada automaticamente.',
  category: 'database',
  version: '11.4',
  icon: '/app-icons/mariadb.svg',
  author: 'Velix Official',
  documentationUrl: 'https://mariadb.com/kb/en/documentation/',
  minResources: { memoryMb: 512 },
  primaryService: 'db',
  primaryPort: 3306,
  secrets: [{ key: 'ROOT_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mariadb:11.4',
      environment: {
        MARIADB_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
        MARIADB_DATABASE: '{{var:DATABASE_NAME}}',
      },
      variables: [{ key: 'DATABASE_NAME', label: 'Nome do banco de dados', type: 'text', default: 'app', required: true }],
      volumes: [{ name: 'data', containerPath: '/var/lib/mysql' }],
      ports: [{ port: 3306, recommended: true }],
    },
  ],
};
