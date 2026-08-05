import type { VelixManifest } from '../catalog.util';

/**
 * Arquivo próprio (não entra na tabela de quick-apps) porque o Immich precisa
 * de um Postgres com extensão de vetores — imagem específica do projeto, não
 * serve o postgres padrão — mais Redis e um serviço de machine learning que o
 * usuário pode dispensar. O ML é o componente pesado (modelos de visão
 * computacional): fica opcional pra caber em servidor pequeno, e sem ele o
 * Immich funciona normalmente, só sem busca por conteúdo e reconhecimento facial.
 */
export const immichManifest: VelixManifest = {
  slug: 'immich',
  name: 'Immich',
  description: 'Backup e galeria de fotos e vídeos do celular, com busca por IA.',
  category: 'media',
  version: 'v1.135.3',
  icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/immich.svg',
  author: 'Velix Official',
  documentationUrl: 'https://immich.app/docs',
  minResources: { memoryMb: 4096 },
  primaryService: 'app',
  primaryPort: 2283,
  secrets: [{ key: 'DB_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'ghcr.io/immich-app/postgres:14-vectorchord0.3.0',
      environment: {
        POSTGRES_USER: 'immich',
        POSTGRES_PASSWORD: '{{secret:DB_PASSWORD}}',
        POSTGRES_DB: 'immich',
        POSTGRES_INITDB_ARGS: '--data-checksums',
      },
      volumes: [{ name: 'db-data', containerPath: '/var/lib/postgresql/data' }],
    },
    {
      name: 'redis',
      image: 'valkey/valkey:8-bookworm',
      volumes: [{ name: 'redis-data', containerPath: '/data' }],
    },
    {
      name: 'machine-learning',
      image: 'ghcr.io/immich-app/immich-machine-learning:v1.135.3',
      optional: true,
      volumes: [{ name: 'model-cache', containerPath: '/cache' }],
    },
    {
      name: 'app',
      image: 'ghcr.io/immich-app/immich-server:v1.135.3',
      dependsOn: ['db', 'redis'],
      environment: {
        DB_HOSTNAME: '{{service:db}}',
        DB_USERNAME: 'immich',
        DB_PASSWORD: '{{secret:DB_PASSWORD}}',
        DB_DATABASE_NAME: 'immich',
        REDIS_HOSTNAME: '{{service:redis}}',
        IMMICH_MACHINE_LEARNING_URL: 'http://{{service:machine-learning}}:3003',
        TZ: '{{var:TZ}}',
      },
      variables: [
        {
          key: 'TZ',
          label: 'Fuso horário',
          description: 'Usado nas datas das fotos e nos trabalhos agendados.',
          type: 'text',
          default: 'America/Sao_Paulo',
          required: true,
        },
      ],
      volumes: [{ name: 'upload', containerPath: '/usr/src/app/upload' }],
      ports: [{ port: 2283, recommended: true }],
    },
  ],
};
