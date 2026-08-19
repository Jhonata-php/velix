import type { VelixManifest } from '../catalog.util';

export const wgEasyManifest: VelixManifest = {
  slug: 'wg-easy',
  name: 'WireGuard Easy',
  description: 'Servidor VPN WireGuard com painel web para gerenciamento de clientes, configurações e QR Codes.',
  category: 'network',
  version: '15',
  icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/wireguard.svg',
  author: 'Velix Official',
  documentationUrl: 'https://github.com/wg-easy/wg-easy',
  minResources: { memoryMb: 256 },

  primaryService: 'app',
  primaryPort: 51821,

  services: [
    {
      name: 'app',
      image: 'ghcr.io/wg-easy/wg-easy:15',

      environment: {
        PORT: '51821',
        WG_PORT: '51820',
        LANG: 'pt',
      },

      volumes: [
        {
          name: 'data',
          containerPath: '/etc/wireguard',
        },
        {
          name: 'modules',
          containerPath: '/lib/modules',
          readOnly: true,
        },
      ],

      ports: [
        {
          port: 51821,
          recommended: true,
        },
        {
          port: 51820,
          protocol: 'udp',
          recommended: true,
        },
      ],

      capabilities: [
        'NET_ADMIN',
        'SYS_MODULE',
      ],

      sysctls: {
        'net.ipv4.ip_forward': '1',
        'net.ipv4.conf.all.src_valid_mark': '1',
      },
    },
  ],
};