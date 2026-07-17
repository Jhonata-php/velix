import type { VelixManifest } from '../catalog.util';

export const ollamaManifest: VelixManifest = {
  slug: 'ollama',
  name: 'Ollama',
  description: 'Executa modelos de linguagem localmente, com API compatível pronta pra uso.',
  category: 'ai',
  version: 'latest',
  icon: '/app-icons/ollama.svg',
  author: 'Velix Official',
  documentationUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  minResources: { memoryMb: 2048 },
  primaryService: 'app',
  primaryPort: 11434,
  services: [
    {
      name: 'app',
      image: 'ollama/ollama:latest',
      volumes: [{ name: 'data', containerPath: '/root/.ollama' }],
      ports: [{ port: 11434, recommended: true }],
    },
  ],
};
