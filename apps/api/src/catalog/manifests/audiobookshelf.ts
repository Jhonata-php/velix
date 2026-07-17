import type { VelixManifest } from '../catalog.util';

export const audiobookshelfManifest: VelixManifest = {
  slug: 'audiobookshelf',
  name: 'Audiobookshelf',
  description: 'Servidor self-hosted de audiobooks e podcasts.',
  category: 'media',
  version: '2.19.4',
  icon: '/app-icons/audiobookshelf.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.audiobookshelf.org/docs',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 80,
  services: [
    {
      name: 'app',
      image: 'ghcr.io/advplyr/audiobookshelf:2.19.4',
      volumes: [
        { name: 'audiobooks', containerPath: '/audiobooks' },
        { name: 'podcasts', containerPath: '/podcasts' },
        { name: 'config', containerPath: '/config' },
        { name: 'metadata', containerPath: '/metadata' },
      ],
      ports: [{ port: 80, recommended: true }],
    },
  ],
};
