import type { VelixManifest } from '../catalog.util';

export const mysqlManifest: VelixManifest = {
  slug: 'mysql',
  name: 'MySQL',
  description: 'Banco de dados relacional MySQL, com senha root gerada automaticamente.',
  category: 'database',
  version: '8.4',
  icon: '/app-icons/mysql.svg',
  author: 'Velix Official',
  documentationUrl: 'https://dev.mysql.com/doc/refman/8.4/en/',
  minResources: { memoryMb: 512 },
  primaryService: 'db',
  primaryPort: 3306,
  secrets: [{ key: 'ROOT_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mysql:8.4',
      environment: {
        MYSQL_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
        MYSQL_DATABASE: '{{var:DATABASE_NAME}}',
      },
      variables: [{ key: 'DATABASE_NAME', label: 'Nome do banco de dados', type: 'text', default: 'app', required: true }],
      volumes: [{ name: 'data', containerPath: '/var/lib/mysql' }],
      ports: [{ port: 3306, recommended: true }],
    },
  ],
};
