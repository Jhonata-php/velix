# Traefik nativo + Domínios — Design

**Status:** aprovado para spec, aguardando revisão do usuário antes do plano de implementação.
**Fase:** 1 de N na migração "Velix substitui o EasyPanel" (ver `NOVA VISÃO DO VELIX`, conversa de 2026-07-16). As fases seguintes (motor de deploy, catálogo de aplicações, marketplace, updates/rollback) dependem desta.

## 1. Objetivo e não-objetivos

**Objetivo desta fase:** o Velix instala e gerencia um Traefik por servidor, e o usuário cadastra domínios que apontam pra uma porta de um serviço já rodando naquele servidor, com SSL automático via Let's Encrypt (DNS-01/Cloudflare). Isso substitui a necessidade de configurar Traefik/domínio manualmente e é o alicerce de ingress que o módulo Aplicações (fase futura) vai usar pra publicar cada app.

**Fora do escopo desta fase** (fica pra depois, quando existir):
- Vínculo Domínio → Aplicação (o módulo Aplicações ainda não existe; por enquanto Domínio aponta pra `servidor + porta` livre)
- Middlewares avançados (rate limit, headers customizados, compressão) configuráveis pela UI — o Traefik já faz isso nativamente, mas a UI de configuração fica pra quando houver um caso de uso real
- Traefik em alta disponibilidade / múltiplas réplicas — uma instância por servidor é suficiente pro modelo atual (tudo já é por-servidor)
- Migração/desativação do EasyPanel existente — combinado que a substituição é imediata, mas isso acontece quando o módulo Aplicações nativo estiver pronto pra receber quem migra, não nesta fase (que é só a fundação de ingress)

## 2. Arquitetura

### 2.1 Topologia
Um Traefik por servidor gerenciado — mesmo padrão de Docker/EasyPanel/MySQL hoje (tudo instalado e operado via SSH, por servidor, sem componente centralizado). Roda como container Docker comum (`docker run`, não Swarm — Traefik não precisa de Swarm pra rotear, e evitar Swarm aqui mantém a mesma superfície operacional do resto do Velix). Container fica numa rede Docker externa dedicada, `velix-public`, que os containers de serviços que quiserem receber tráfego externo também precisam entrar (isso já é possível hoje pra qualquer container criado via Velix — quando o módulo Aplicações existir, ele conecta o container nessa rede automaticamente).

Portas do host: 80 e 443 mapeadas pro container do Traefik. Se a 80/443 já estiverem ocupadas (ex.: EasyPanel/Nginx antigo rodando), a instalação falha com uma mensagem clara em vez de tentar contornar — usuário resolve o conflito manualmente antes.

### 2.2 Descoberta e configuração: File Provider
Traefik oferece dois jeitos principais de descobrir rotas: labels em containers Docker (discovery automático) ou um provider de arquivo dinâmico que alguém externo escreve. Escolhido: **file provider**. Motivo: o pedido original quer que o Velix seja dono da configuração de ingress e consiga versionar/auditar — isso é natural com um arquivo que o Velix gera e versiona (fica óbvio o que muda a cada operação), e complicado de rastrear com labels espalhadas em containers arbitrários. O Traefik é iniciado com:

```
--providers.file.directory=/etc/traefik/dynamic
--providers.file.watch=true
```

Cada domínio cadastrado vira um arquivo `<domainId>.yml` dentro desse diretório (um arquivo por domínio facilita adicionar/remover sem reescrever um arquivo monolítico e sem lock de concorrência). O Velix escreve esse arquivo via SFTP (`SshService.uploadFile`, que já existe e já é usado pra transferir dumps entre servidores) a partir de um arquivo temporário local gerado com o template abaixo.

Template do arquivo dinâmico por domínio:

```yaml
http:
  routers:
    <domainId>:
      rule: "Host(`<hostname>`)"
      service: <domainId>
      entryPoints: [websecure]
      tls:
        certResolver: velix-le
  services:
    <domainId>:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:<targetPort>"
```

`targetPort` nesta fase é uma porta já publicada no host pelo serviço que o usuário quer expor (igual ao que já existe hoje: um container qualquer com `-p <porta>:<porta>`). Pra o container do Traefik alcançar isso, ele é iniciado com `--add-host=host.docker.internal:host-gateway` (suportado desde Docker 20.10, cobre o `dockerInstalled` mínimo que o Velix já exige em outros lugares) — sem isso `host.docker.internal` não resolve em hosts Linux. Quando o módulo Aplicações existir e os containers de app entrarem na rede `velix-public`, o alvo passa a ser o nome do container nessa rede (`http://<containerName>:<port>`) em vez do host — mudança aditiva na função que gera o YAML, não estrutural.

(Redirecionamento HTTP→HTTPS é um router/middleware global fixo, configurado uma vez na instalação, não por domínio.)

### 2.3 TLS / Let's Encrypt via Cloudflare DNS-01
O Traefik tem suporte nativo ao provider DNS da Cloudflare pra resolver o desafio ACME — ele mesmo cuida de emissão e renovação automática, o Velix não implementa nada do protocolo ACME. O Velix só precisa:
1. Descriptografar o token da `CloudflareAccount` já conectada (mesma função usada hoje pra falar com a API da Cloudflare)
2. Passar esse token pro container do Traefik como variável de ambiente (`CF_DNS_API_TOKEN`), escrita num arquivo de env no servidor remoto (nunca em texto plano num comando de shell, pelo mesmo motivo que credenciais de banco já são tratadas assim hoje)
3. Configurar o `certResolver` `velix-le` no Traefik estático (`--certificatesresolvers.velix-le.acme.dnschallenge.provider=cloudflare`, storage em `/etc/traefik/acme.json` no volume persistente do container)

**Pré-requisito obrigatório:** conta Cloudflare conectada em Configurações (decidido na conversa — sem isso, o módulo Domínios fica bloqueado com uma mensagem explicando o porquê, sem caminho alternativo de SSL manual pra manter).

### 2.4 Instalação
Diferente do EasyPanel (que tem um script oficial hospedado em `get.easypanel.io`), não existe instalador oficial do Traefik pra baixar e rodar — o Velix monta o `docker run` diretamente. Sequência (streamada via `onLog`, mesmo padrão de `installDocker`/`installEasyPanel`):
1. Checa Docker instalado (pré-requisito, mesmo padrão do EasyPanel) e portas 80/443 livres
2. Cria a rede `velix-public` (`docker network create`, idempotente — ignora erro se já existir)
3. Cria diretórios remotos `/etc/velix-traefik/{dynamic,acme}` e escreve o Traefik estático (`traefik.yml`) e o arquivo de env com o token Cloudflare via SFTP
4. Roda `docker run -d --name velix-traefik --network velix-public -p 80:80 -p 443:443 -v ... --env-file ... traefik:v3.x`
5. Poll de saúde: `docker ps --filter name=velix-traefik --format '{{.Status}}'` até aparecer "Up" (mesmo padrão de `waitForEasyPanelRunning`)
6. Grava `traefikInstalled=true`, `traefikVersion` no `Server`

## 3. Modelo de dados (Prisma — `db push`, sem migration versionada, mesmo padrão do resto do schema)

```prisma
model Server {
  // ...campos existentes...
  traefikInstalled Boolean @default(false)
  traefikVersion   String?

  domains Domain[]
}

enum DomainStatus {
  PENDING       // criado, ainda não verificado/roteando
  ACTIVE        // roteando e respondendo em HTTPS
  ERROR         // falha ao emitir certificado ou registrar DNS
}

model Domain {
  id                 String       @id @default(uuid())
  serverId           String
  server             Server       @relation(fields: [serverId], references: [id], onDelete: Cascade)
  hostname           String       @unique
  targetPort         Int
  createDnsRecord    Boolean      @default(true)
  cloudflareRecordId String?
  status             DomainStatus @default(PENDING)
  lastError          String?
  lastCheckedAt      DateTime?
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt
}
```

`hostname` é `@unique` globalmente (um domínio não pode apontar pra dois lugares ao mesmo tempo — regra simples que evita config ambígua no Traefik). Quando o módulo Aplicações existir, adiciona-se `applicationId String?` opcional — não precisa de migração destrutiva, é aditivo.

## 4. API (mesma convenção REST de `/servers/:id/...` já usada)

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/servers/:id/traefik/install` | dispara instalação (via WebSocket `/ops`, op `traefik-install`, mesmo mecanismo do EasyPanel) |
| `POST` | `/servers/:id/traefik/uninstall` | remove container, rede e configs (op `traefik-uninstall`) |
| `GET` | `/servers/:id/traefik/status` | `{ installed, version, running, domainsCount }` — reconfere ao vivo via `docker ps`, mesmo padrão de `easypanelStatus` |
| `POST` | `/servers/:id/domains` | cria domínio: `{ hostname, targetPort, createDnsRecord }` — cria registro DNS na Cloudflare se pedido, escreve o arquivo dinâmico, marca `PENDING` |
| `GET` | `/servers/:id/domains` | lista domínios do servidor |
| `GET` | `/domains/:domainId/verify` | reconfere (fetch HTTPS real, mesmo padrão de `verifyEasyPanelDomain`) e atualiza `status`/`lastError` |
| `DELETE` | `/domains/:domainId` | remove o arquivo dinâmico do servidor, remove o registro DNS se foi o Velix que criou, apaga a linha |

`traefik-install` e `traefik-uninstall` precisam de uma nova entrada na union `StartMessage` e um novo `else if` em `ops-server.ts` (o dispatch é uma cadeia if/else hoje, não um registry — seguir o padrão existente em vez de refatorar pra registry nesta fase).

## 5. Frontend

Nova aba "Domínios" no `ContextNav` do servidor (grupo Serviços, ícone novo — ex. um ícone de globo). Reaproveita os componentes já construídos nas fases anteriores:
- `ModuleHeader` (título "Domínios", versão do Traefik, botão instalar/menu de desinstalar)
- Estado "Traefik não instalado": `EmptyState` com botão "Instalar Traefik" → `InstallLogModal` (novo op `traefik-install`, mesmo componente já usado por Docker/EasyPanel/MySQL)
- Estado instalado sem Cloudflare conectado: bloqueio com link direto pra Configurações
- Lista de domínios: `Toolbar` (busca por hostname) + linhas por domínio usando `StatusBadge` (PENDING=warning, ACTIVE=success, ERROR=danger) + `ActionMenu` (Verificar agora, Remover)
- Formulário de criação: modal simples (hostname, porta, checkbox "criar registro DNS automaticamente" — mesmo padrão do form de instalação do EasyPanel)

## 6. Erros e casos de borda
- Porta 80/443 ocupada na instalação → erro explícito, não tenta matar o processo que está usando
- Domínio duplicado (constraint `@unique`) → 409 com mensagem clara
- Cloudflare token revogado/expirado no meio do fluxo → `status: ERROR`, `lastError` com a mensagem da API, domínio fica listado (não desaparece) pra o usuário corrigir e tentar de novo
- Servidor offline no momento da criação do domínio → mesma UX de erro já usada nas outras instalações (Alert vermelho, nada é criado no banco se o SSH falhar antes de qualquer escrita remota)

## 7. Segurança
- Token Cloudflare nunca aparece em log nem em comando de shell montado como string — vai para um arquivo de env no servidor remoto via SFTP, mesmo tratamento que outras credenciais (`*Enc` + AES-256-GCM, decriptado só em memória no momento do uso)
- `acme.json` (onde o Traefik guarda as chaves privadas dos certificados) fica em volume no servidor gerenciado, com permissão 600 — nunca trafega pelo Velix

## 8. Plano de teste
Cada peça de lógica não-trivial ganha um teste mínimo executável antes de considerar a fase pronta:
- Geração do YAML dinâmico por domínio (função pura) → teste unitário comparando string gerada
- Parsing do `docker ps --filter name=velix-traefik` pra status → teste unitário com saída de exemplo
- Fluxo de criação de domínio com Cloudflare indisponível → teste garantindo que `status` vira `ERROR` e nada quebra o restante da resposta
