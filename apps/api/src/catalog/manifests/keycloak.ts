import type { VelixManifest } from '../catalog.util';

// ponytail: sobe em modo start-dev (banco H2 embutido) — suficiente pra testar
// e usar em escala pequena; um banco Postgres dedicado fica pra quando o
// engine suportar mais de um "modo" de implantação por template.
export const keycloakManifest: VelixManifest = {
  slug: 'keycloak',
  name: 'Keycloak',
  description: 'Gerenciamento de identidade e acesso (SSO, OAuth2, OIDC).',
  category: 'security',
  version: '26.0',
  icon: '/app-icons/keycloak.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.keycloak.org/documentation',
  minResources: { memoryMb: 1024 },
  primaryService: 'app',
  primaryPort: 8080,
  secrets: [{ key: 'ADMIN_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'quay.io/keycloak/keycloak:26.0',
      command: 'start-dev',
      environment: {
        KEYCLOAK_ADMIN: '{{var:ADMIN_USER}}',
        KEYCLOAK_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}',
      },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true }],
      volumes: [{ name: 'data', containerPath: '/opt/keycloak/data' }],
      ports: [{ port: 8080, recommended: true }],
    },
  ],
};
