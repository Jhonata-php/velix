import type { VelixManifest } from '../catalog.util';

export const jellyfinManifest: VelixManifest = {
  slug: 'jellyfin',
  name: 'Jellyfin',
  description: 'Servidor de mídia self-hosted para filmes, séries e música.',
  category: 'media',
  version: '10.9.11',
  icon: '/app-icons/jellyfin.svg',
  author: 'Velix Official',
  documentationUrl: 'https://jellyfin.org/docs/',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 8096,
  services: [
    {
      name: 'app',
      image: 'jellyfin/jellyfin:10.9.11',
      volumes: [
        { name: 'config', containerPath: '/config' },
        { name: 'cache', containerPath: '/cache' },
        { name: 'media', containerPath: '/media' },
      ],
      ports: [{ port: 8096, recommended: true }],
    },
  ],
};
