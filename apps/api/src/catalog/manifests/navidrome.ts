import type { VelixManifest } from '../catalog.util';

// ponytail: sem logo na Simple Icons — AppIcon cai no ícone genérico em vez de inventar um.
export const navidromeManifest: VelixManifest = {
  slug: 'navidrome',
  name: 'Navidrome',
  description: 'Servidor de música self-hosted compatível com Subsonic.',
  category: 'media',
  version: '0.54.5',
  icon: '/app-icons/navidrome.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.navidrome.org/docs/',
  minResources: { memoryMb: 256 },
  primaryService: 'app',
  primaryPort: 4533,
  services: [
    {
      name: 'app',
      image: 'deluan/navidrome:0.54.5',
      volumes: [
        { name: 'data', containerPath: '/data' },
        { name: 'music', containerPath: '/music' },
      ],
      ports: [{ port: 4533, recommended: true }],
    },
  ],
};
