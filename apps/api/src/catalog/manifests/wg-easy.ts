import type { VelixManifest } from '../catalog.util';

/**
 * WireGuard Easy — servidor VPN com painel web.
 *
 * Só pede NET_ADMIN: criar a interface wg0 exige NET_ADMIN.
 *
 * SYS_MODULE não é necessário quando o kernel do host já possui
 * suporte ao WireGuard. Além disso, o Velix não permite bind mount
 * arbitrário de /lib/modules do host através do sistema de volumes.
 *
 * 51821/tcp = painel web
 * 51820/udp = tráfego WireGuard
 */
export const wgEasyManifest: VelixManifest = {
  slug: 'wg-easy',
  name: 'WireGuard Easy',
  description:
    'Servidor VPN WireGuard com painel web para gerenciar clientes, configurações e QR Codes.',
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
        DISABLE_IPV6: 'true',
      },

      volumes: [
        {
          name: 'data',
          containerPath: '/etc/wireguard',
        },
      ],

      ports: [
        {
          port: 51821,
          protocol: 'tcp',
        },
        {
          port: 51820,
          protocol: 'udp',
          recommended: true,
        },
      ],

      capabilities: ['NET_ADMIN'],

      sysctls: {
        'net.ipv4.ip_forward': '1',
        'net.ipv4.conf.all.src_valid_mark': '1',
      },
    },
  ],
};