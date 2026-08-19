import type { VelixManifest } from '../catalog.util';

/**
 * WireGuard Easy — servidor VPN com painel web.
 *
 * Só pede `NET_ADMIN` (não `SYS_MODULE`): criar a interface `wg0` exige
 * NET_ADMIN, mas carregar o módulo do kernel de dentro do container exigiria
 * SYS_MODULE — uma capability bem mais perigosa (deixa carregar QUALQUER
 * módulo pelo nome, não só o do WireGuard) e um bind mount de
 * `/lib/modules` do host que o Velix não tem como expressar hoje (o sistema
 * de volumes só cria volumes próprios, não monta caminho do host). Kernels
 * atuais (5.6+, praticamente todo VPS moderno) já trazem o módulo
 * `wireguard` — sem SYS_MODULE o container só usa o que o host já tem.
 *
 * Duas portas com papéis diferentes: 51821/tcp é o painel web, routeado
 * normalmente por domínio (primaryService/primaryPort, como qualquer outro
 * app). 51820/udp é o tráfego real da VPN — não passa por domínio (Traefik
 * só roteia HTTP/HTTPS), por isso é a porta `recommended` aqui: é a que a
 * tela "Publicar porta" do serviço sugere expor direto no host pros clientes
 * WireGuard conseguirem conectar.
 */
export const wgEasyManifest: VelixManifest = {
  slug: 'wg-easy',
  name: 'WireGuard Easy',
  description: 'Servidor VPN WireGuard com painel web para gerenciar clientes, configurações e QR Codes.',
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

      volumes: [{ name: 'data', containerPath: '/etc/wireguard' }],

      ports: [
        { port: 51821, protocol: 'tcp' },
        { port: 51820, protocol: 'udp', recommended: true },
      ],

      capabilities: ['NET_ADMIN'],

      sysctls: {
        'net.ipv4.ip_forward': '1',
        'net.ipv4.conf.all.src_valid_mark': '1',
      },
    },
  ],
};
