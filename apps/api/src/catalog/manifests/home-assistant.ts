import type { VelixManifest } from '../catalog.util';

// ponytail: sem network_mode: host (não suportado pelo renderCompose ainda) —
// descoberta mDNS/integrações de rede local ficam limitadas, mas a interface
// web funciona normalmente atrás do Traefik.
export const homeAssistantManifest: VelixManifest = {
  slug: 'home-assistant',
  name: 'Home Assistant',
  description: 'Plataforma de automação residencial de código aberto.',
  category: 'automation',
  version: 'stable',
  icon: '/app-icons/homeassistant.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.home-assistant.io/docs/',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 8123,
  services: [
    {
      name: 'app',
      image: 'homeassistant/home-assistant:stable',
      volumes: [{ name: 'config', containerPath: '/config' }],
      ports: [{ port: 8123, recommended: true }],
    },
  ],
};
