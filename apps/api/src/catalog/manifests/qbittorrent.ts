import type { VelixManifest } from '../catalog.util';

export const qbittorrentManifest: VelixManifest = {
  slug: 'qbittorrent',
  name: 'qBittorrent',
  description: 'Cliente BitTorrent com interface web, self-hosted.',
  category: 'network',
  version: '5.0.2',
  icon: '/app-icons/qbittorrent.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.linuxserver.io/images/docker-qbittorrent/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 8080,
  services: [
    {
      name: 'app',
      image: 'linuxserver/qbittorrent:5.0.2',
      environment: {
        WEBUI_PORT: '8080',
        TZ: '{{var:TIMEZONE}}',
      },
      variables: [{ key: 'TIMEZONE', label: 'Fuso horário', type: 'text', default: 'America/Sao_Paulo', required: true }],
      volumes: [
        { name: 'config', containerPath: '/config' },
        { name: 'downloads', containerPath: '/downloads' },
      ],
      ports: [
        { port: 8080, recommended: true },
        { port: 6881, protocol: 'tcp' },
        { port: 6881, protocol: 'udp' },
      ],
    },
  ],
};
