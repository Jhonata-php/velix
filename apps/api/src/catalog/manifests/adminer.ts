import type { VelixManifest } from '../catalog.util';

/**
 * Cliente web genérico pra bancos SQL — sem senha própria nem conexão
 * pré-configurada no compose: o login (servidor/usuário/senha) é digitado na
 * própria tela do Adminer, na hora. `DEFAULT_SERVER` só pré-preenche o campo
 * "Servidor" do formulário de login — quando implantado a partir do botão
 * "Abrir interface web" de um banco (ver applications no frontend), o Velix
 * já manda o nome do container daquele banco aqui, e como os dois ficam na
 * mesma rede `velix-proxy`, o nome resolve sozinho via DNS interno do Docker.
 */
export const adminerManifest: VelixManifest = {
  slug: 'adminer',
  name: 'Adminer',
  description: 'Interface web pra administrar bancos SQL (MySQL, MariaDB, PostgreSQL) — login digitado na hora, sem senha própria.',
  category: 'development',
  version: '4.8.1',
  icon: '/app-icons/adminer.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.adminer.org/',
  minResources: { memoryMb: 64 },
  primaryService: 'adminer',
  primaryPort: 8080,
  services: [
    {
      name: 'adminer',
      image: 'adminer:4.8.1',
      environment: {
        ADMINER_DEFAULT_SERVER: '{{var:DEFAULT_SERVER}}',
      },
      variables: [
        {
          key: 'DEFAULT_SERVER',
          label: 'Servidor pré-preenchido no login (opcional)',
          description: 'Nome do container do banco — deixe em branco pra digitar na hora.',
          type: 'text',
        },
      ],
      ports: [{ port: 8080, recommended: true }],
    },
  ],
};
