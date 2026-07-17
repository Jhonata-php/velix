import type { VelixManifest } from '../catalog.util';

// ponytail: sem logo na Simple Icons — AppIcon cai no ícone genérico em vez de inventar um.
export const openWebuiManifest: VelixManifest = {
  slug: 'open-webui',
  name: 'Open WebUI',
  description: 'Interface web para conversar com modelos de linguagem (Ollama ou compatível).',
  category: 'ai',
  version: 'main',
  icon: '/app-icons/openwebui.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.openwebui.com/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 8080,
  services: [
    {
      name: 'app',
      image: 'ghcr.io/open-webui/open-webui:main',
      environment: { OLLAMA_BASE_URL: '{{var:OLLAMA_BASE_URL}}' },
      variables: [
        {
          key: 'OLLAMA_BASE_URL',
          label: 'URL do Ollama',
          description: 'Endereço de um servidor Ollama já implantado (ex.: http://ollama_app:11434). Deixe em branco pra configurar depois.',
          type: 'text',
          default: '',
        },
      ],
      volumes: [{ name: 'data', containerPath: '/app/backend/data' }],
      ports: [{ port: 8080, recommended: true }],
    },
  ],
};
