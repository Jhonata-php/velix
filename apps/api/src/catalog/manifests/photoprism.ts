import type { VelixManifest } from '../catalog.util';

// ponytail: sem logo na Simple Icons — AppIcon cai no ícone genérico em vez de inventar um.
export const photoprismManifest: VelixManifest = {
  slug: 'photoprism',
  name: 'PhotoPrism',
  description: 'Galeria de fotos com organização por IA, self-hosted.',
  category: 'media',
  version: 'latest',
  icon: '/app-icons/photoprism.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.photoprism.app/',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 2342,
  secrets: [{ key: 'ADMIN_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'photoprism/photoprism:latest',
      environment: {
        PHOTOPRISM_ADMIN_USER: '{{var:ADMIN_USER}}',
        PHOTOPRISM_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}',
      },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true }],
      volumes: [
        { name: 'originals', containerPath: '/photoprism/originals' },
        { name: 'storage', containerPath: '/photoprism/storage' },
      ],
      ports: [{ port: 2342, recommended: true }],
    },
  ],
};
