import type { VelixManifest } from '../catalog.util';

/** Primeiro template real do catálogo oficial — usado pra provar o motor de
 * implantação de ponta a ponta antes de multiplicar pra outras aplicações. */
export const uptimeKumaManifest: VelixManifest = {
  slug: 'uptime-kuma',
  name: 'Uptime Kuma',
  description: 'Monitor de disponibilidade self-hosted, com painel visual e notificações.',
  category: 'monitoring',
  version: '1.23.16',
  icon: '/app-icons/uptime-kuma.svg',
  author: 'Velix Official',
  documentationUrl: 'https://github.com/louislam/uptime-kuma',
  minResources: { memoryMb: 256 },
  primaryService: 'app',
  primaryPort: 3001,
  services: [
    {
      name: 'app',
      image: 'louislam/uptime-kuma:1.23.16',
      volumes: [{ name: 'data', containerPath: '/app/data' }],
      ports: [{ port: 3001, recommended: true }],
    },
  ],
};
