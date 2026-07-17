import type { VelixManifest } from '../catalog.util';

export const nodeRedManifest: VelixManifest = {
  slug: 'node-red',
  name: 'Node-RED',
  description: 'Ferramenta de programação visual para automações e integrações via fluxos.',
  category: 'automation',
  version: '4.0.9',
  icon: '/app-icons/nodered.svg',
  author: 'Velix Official',
  documentationUrl: 'https://nodered.org/docs/',
  minResources: { memoryMb: 256 },
  primaryService: 'app',
  primaryPort: 1880,
  services: [
    {
      name: 'app',
      image: 'nodered/node-red:4.0.9',
      volumes: [{ name: 'data', containerPath: '/data' }],
      ports: [{ port: 1880, recommended: true }],
    },
  ],
};
