# Velix

Plataforma para gerenciamento de servidores Linux via SSH — cadastro de servidores, teste de conexão real, dashboard e autenticação.

Implementado até agora, tudo com execução real via SSH (nada simulado):

- Autenticação, dashboard, tema claro/escuro, cadastro de servidores
- Cloudflare: conta/token na aba Configurações, zonas, CRUD de registros DNS, descoberta de domínios por IP
- Atualizações de Linux (apt/dnf/yum): checar e instalar (todas ou só segurança)
- Docker: instalação real (get.docker.com) + status/containers
- EasyPanel: instalação real (get.easypanel.io) + DNS automático via Cloudflare
- MySQL: instalação via Docker já pronta para replicação, criação de réplica (dump + SFTP + `CHANGE REPLICATION SOURCE` com GTID), monitoramento de sincronização e **promoção manual** de réplica (com confirmação explícita — sem failover automático)

Ainda não implementado: Docker Swarm/clusters, PostgreSQL, backups, failover automático com máquina de estados.

## Stack

- `apps/api`: NestJS + Prisma + PostgreSQL, autenticação JWT, teste de conexão SSH real (`ssh2`)
- `apps/web`: Next.js (App Router) + Tailwind, tema claro/escuro, dashboard e cadastro de servidores

Só a porta do Next.js (3000) fica exposta: `next.config.js` proxeia `/api/*` para o NestJS internamente (`rewrites`), então o browser nunca faz requisição cross-origin e não há CORS pra configurar.

## Rodando em produção (Ubuntu)

Em um Ubuntu limpo (20.04+), como root:

```bash
curl -fsSL https://raw.githubusercontent.com/Jhonata-php/velix/main/install.sh | sudo bash
```

O script instala o Docker se necessário, clona o repositório em `/opt/velix`, gera segredos aleatórios em `.env` e sobe tudo com `docker compose`. No final ele imprime a URL do painel e a senha do admin gerada.

Se você já clonou o repositório manualmente:

```bash
cd velix
sudo REPO_DIR=$(pwd) ./install.sh
```

Para atualizar depois de um `git pull`, basta rodar `docker compose up -d --build` novamente.

## Rodando localmente (desenvolvimento)

Requer Node 20+ e um PostgreSQL local (ou `docker compose up postgres` só do banco).

**Primeira vez** — instala as dependências das duas apps e prepara o banco:

```bash
cd apps/api && cp .env.example .env   # ajuste DATABASE_URL se necessário
npm install
npx prisma db push
npm run seed              # cria o usuário admin@velix.local / changeme123
cd ../../apps/web && npm install
cd ../..
```

**Depois disso, um comando só sobe backend e frontend juntos:**

```bash
npm install   # só na primeira vez, instala o `concurrently` na raiz
npm run dev   # sobe apps/api (:3001, interno) e apps/web (:3000) juntos
```

Abra http://localhost:3000 — o proxy `/api/*` do Next.js já aponta pra `:3001` automaticamente.

Se preferir rodar cada um em um terminal separado (ex.: pra ver os logs isolados), pode continuar usando `npm run dev` dentro de `apps/api` e de `apps/web` individualmente — os scripts continuam existindo, o `npm run dev` da raiz só chama os dois ao mesmo tempo.

## Variáveis de ambiente

Veja [.env.example](.env.example) (raiz, usado pelo `docker-compose.yml`) e [apps/api/.env.example](apps/api/.env.example) (uso local sem Docker).

## Próximos passos

Docker Swarm/clusters, PostgreSQL, backups agendados, e failover automático com máquina de estados e fencing real (o que existe hoje é promoção manual, de propósito — ver seção acima).
