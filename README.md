# Velix

Velix é uma plataforma para gerenciamento de servidores Linux via SSH.

Ele permite centralizar servidores, Docker, atualizações, bancos de dados, DNS, métricas e acesso remoto em uma única interface.

## Funcionalidades

- Autenticação e painel administrativo
- Tema claro e escuro
- Cadastro de servidores Linux
- Teste real de conexão SSH
- Métricas de CPU, memória, disco, uptime e load average
- Atualização automática das métricas
- Reinicialização remota de servidores
- Terminal web SSH com WebSocket e xterm.js
- Verificação e instalação de atualizações Linux
- Suporte a apt, dnf e yum
- Instalação e gerenciamento de Docker
- Listagem e monitoramento de containers
- Instalação remota do EasyPanel
- Integração com Cloudflare
- Gerenciamento de zonas e registros DNS
- Descoberta de domínios por endereço IP
- Instalação de MySQL via Docker
- Configuração de replicação MySQL com GTID
- Criação e monitoramento de réplicas
- Promoção manual de réplica

Todas as operações são executadas de forma real nos servidores cadastrados.

## Tecnologias

### Backend

- NestJS
- Prisma
- PostgreSQL
- JWT
- SSH2
- WebSocket

### Frontend

- Next.js
- App Router
- Tailwind CSS
- xterm.js

### Infraestrutura

- Docker
- Docker Compose
- Traefik
- Let's Encrypt

## Instalação

O repositório é privado. Primeiro faça o clone utilizando sua conta e um token do GitHub:

```bash
git clone https://github.com/Jhonata-php/velix.git
cd velix
chmod +x install.sh
sudo ./install.sh