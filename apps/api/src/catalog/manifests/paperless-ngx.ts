import type { VelixManifest } from '../catalog.util';

export const paperlessNgxManifest: VelixManifest = {
  slug: 'paperless-ngx',
  name: 'Paperless-ngx',
  description: 'Digitalização e organização de documentos com OCR, self-hosted.',
  category: 'productivity',
  version: '2.13',
  icon: '/app-icons/paperlessngx.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.paperless-ngx.com/',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 8000,
  secrets: [{ key: 'SECRET_KEY' }, { key: 'ADMIN_PASSWORD' }],
  services: [
    {
      name: 'redis',
      image: 'redis:7.4',
      volumes: [{ name: 'redis-data', containerPath: '/data' }],
    },
    {
      name: 'app',
      image: 'ghcr.io/paperless-ngx/paperless-ngx:2.13',
      environment: {
        PAPERLESS_REDIS: 'redis://{{service:redis}}:6379',
        PAPERLESS_SECRET_KEY: '{{secret:SECRET_KEY}}',
        PAPERLESS_ADMIN_USER: '{{var:ADMIN_USER}}',
        PAPERLESS_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}',
      },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true }],
      volumes: [
        { name: 'data', containerPath: '/usr/src/paperless/data' },
        { name: 'media', containerPath: '/usr/src/paperless/media' },
        { name: 'consume', containerPath: '/usr/src/paperless/consume' },
      ],
      ports: [{ port: 8000, recommended: true }],
    },
  ],
};
