import type { VelixManifest } from '../catalog.util';

export const postgresqlManifest: VelixManifest = {
  slug: 'postgresql',
  name: 'PostgreSQL',
  description: 'Banco de dados relacional PostgreSQL, com senha gerada automaticamente.',
  category: 'database',
  version: '16.4',
  icon: '/app-icons/postgresql.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.postgresql.org/docs/16/index.html',
  minResources: { memoryMb: 256 },
  primaryService: 'db',
  primaryPort: 5432,
  secrets: [{ key: 'POSTGRES_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'postgres:16.4',
      environment: {
        POSTGRES_PASSWORD: '{{secret:POSTGRES_PASSWORD}}',
        POSTGRES_DB: '{{var:DATABASE_NAME}}',
      },
      variables: [
        {
          key: 'DATABASE_NAME',
          label: 'Nome do banco de dados (opcional)',
          description: 'Deixe em branco pra não criar nenhum — crie e gerencie pelo painel, na aba Dados.',
          type: 'text',
        },
      ],
      volumes: [{ name: 'data', containerPath: '/var/lib/postgresql/data' }],
      ports: [{ port: 5432, recommended: true }],
    },
  ],
};
