# Monitoramento em tempo real + push notifications — Design (backend)

**Status:** aprovado pelo usuário na conversa, seção por seção (arquitetura de streaming SSH + FCM; modelo de dados por usuário; endpoints/resiliência/testes).
**Contexto:** o usuário quer criar dois apps móveis nativos (iOS e Android) pro Velix, com push notification pra temperatura alta, CPU, memória e problemas de container (parou/reiniciou), configurável por pessoa. O projeto foi quebrado em sub-projetos porque é grande demais pra um spec só:

1. **Este documento** — backend: monitoramento em tempo real + infraestrutura de push
2. Produto/UX compartilhada dos apps (onboarding, login+2FA, troca de servidor, dashboard, config de notificações)
3. App iOS nativo (SwiftUI)
4. App Android nativo (Kotlin/Compose)
5. Publicação nas lojas (App Store / Play Store) — depois dos apps prontos

Levantamento do estado atual (feito antes deste spec): auth já é JWT Bearer + 2FA/TOTP completo (mobile-friendly sem mudança). Velix é um control-plane único que fala com cada servidor por SSH (sem agente) — "multi-servidor" é só listar `/servers` dessa API. Métricas hoje são só load average/memória/disco, coletadas sob demanda via SSH a cada poll do frontend, sem CPU%, sem temperatura. Alertas existem mas com condições fixas no código (offline, disco ≥90%, app com erro, backup atrasado), sem push, sem detecção de evento de container.

## 1. Objetivo e não-objetivos

**Objetivo:** cada servidor cadastrado é monitorado continuamente (não só sob demanda) para CPU%, memória%, temperatura (quando disponível) e eventos de container (parou/reiniciou/crash) — quase em tempo real. Cada usuário do Velix configura seus próprios limites de alerta (padrão global + override por servidor) e recebe push no(s) celular(es) onde está logado, através de um novo canal de notificação (Firebase Cloud Messaging) que convive com os canais que já existem (Discord/Telegram/webhook).

**Fora do escopo desta fase:**
- Os apps móveis em si (specs separados, depois deste)
- Editar/remover os canais de alerta existentes (Discord/Telegram/webhook) — só é adicionado um canal novo, os outros continuam como estão
- Tornar as condições de alerta já existentes (offline, disco, app com erro, backup atrasado) configuráveis — só as condições novas (CPU/memória/temperatura/docker) nascem configuráveis
- Suporte a servidores Windows — assume-se Linux com Docker, como o resto do Velix já assume
- Agente instalado nos servidores (opção C considerada e descartada — ver seção 2)

## 2. Arquitetura de monitoramento

### 2.1 Por que SSH streaming e não um agente

Três abordagens foram consideradas:

- **Agente instalado em cada servidor** (como Netdata/Grafana Agent): mais escalável a longo prazo, mas exige instalar e manter um binário/serviço em cada máquina — uma mudança de filosofia do produto, que hoje não instala nada nos servidores gerenciados, só acessa por SSH. Descartado por ora.
- **Script remoto único combinando eventos + métricas** numa única sessão SSH: menos conexões, mas depende de bash/coreutils disponíveis no servidor remoto — pode quebrar em distros com shell mínimo (Alpine/busybox).
- **Duas streams por servidor sobre a mesma conexão SSH** (escolhida): reaproveita exatamente o padrão que já existe em `apps/api/src/servers/servers.service.ts` (`streamContainerLogs`, hoje usado pra `docker logs -f`) e `ssh.service.ts`. Sem exigir nada novo instalado no servidor, e mais robusto a diferenças entre distros porque cada comando roda isolado.

### 2.2 `ServerWatcher`

Novo módulo `apps/api/src/monitoring/`. Uma instância de `ServerWatcher` por servidor cadastrado:

- Inicia quando a API sobe (um watcher por `Server` existente) e quando um servidor novo é cadastrado; para quando o servidor é removido.
- Abre uma conexão SSH persistente (reaproveita `ssh.service.ts`) com dois streams lógicos:
  - **Eventos de container**: `docker events --format '{{json .}}'` rodando continuamente. Cada linha é parseada e normalizada num evento (`container_stopped`, `container_restarted`, `container_crashed` — distinção por `exitCode`/`action` do evento do Docker).
  - **Amostrador de métricas**: a cada N segundos (padrão 5s, mesmo processo do watcher, não uma nova conexão) roda um comando leve pra CPU% (`/proc/stat` delta ou equivalente) e memória% (reaproveita `metrics.util.ts` existente). Tenta `sensors -j` pra temperatura na primeira amostra; se o comando falhar (não instalado / sem sensor exposto — comum em VPS/cloud), marca aquele servidor como "sem sensor de temperatura" e não tenta mais, sem gerar erro nem alerta falso.
- Se a conexão SSH cair, reconecta com backoff exponencial (5s → 10s → 30s → 60s, teto em 60s). Enquanto não reconectar, o servidor já cai na condição de alerta "offline" que existe hoje (reaproveitada, sem duplicar lógica).

### 2.3 Avaliação de limites e disparo de alerta

Cada amostra de métrica e cada evento de container passa pelo avaliador de alertas existente (`apps/api/src/alerts/alerts.service.ts`), estendido com as condições novas. Reaproveita o mecanismo de fingerprint/dedupe (`AlertState`) que já existe pras condições atuais, incluindo cooldown: uma condição que já está ativa não reenvia notificação a cada amostra, só quando muda de estado (abre/resolve) ou depois de um intervalo mínimo configurável (padrão 15 min) se continuar ativa.

## 3. Modelo de dados (Prisma)

```prisma
model DeviceToken {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform   String   // "ios" | "android"
  fcmToken   String   @unique
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([userId])
}

model AlertThresholdPreference {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  serverId          String?  // null = padrão global da pessoa
  server            Server?  @relation(fields: [serverId], references: [id], onDelete: Cascade)

  cpuPercent        Int?     // null = desabilitado
  memoryPercent     Int?
  temperatureCelsius Int?
  dockerScope       String   @default("all") // "all" | "managed_apps"
  dockerEnabled     Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, serverId])
}
```

`ServerMetricSample` (já existe) ganha duas colunas novas: `cpuPercent Float?` e `temperatureCelsius Float?` — ambas opcionais porque nem todo servidor vai ter os dois disponíveis (o histórico existente continua válido, os dois campos ficam `null` em amostras antigas).

`User` e `Server` ganham as relações inversas (`deviceTokens DeviceToken[]`, `alertThresholds AlertThresholdPreference[]` em `User`; `alertThresholdOverrides AlertThresholdPreference[]` em `Server`).

Resolução do limite efetivo pra um `(userId, serverId)`: busca `AlertThresholdPreference` com esse `serverId` exato; se não existir, cai pro registro com `serverId: null` (padrão global da pessoa); se esse também não existir, a condição fica desabilitada pra essa pessoa (sem alerta, sem exigir configuração prévia obrigatória).

Nota técnica: `@@unique([userId, serverId])` não impede duas linhas com `serverId` nulo pro mesmo usuário no Postgres (`NULL` não é igual a `NULL` pra fins de unique constraint). O upsert do registro global (`PUT /alerts/thresholds`) busca por `findFirst({ userId, serverId: null })` antes de decidir entre `update`/`create`, em vez de depender do constraint pra esse caso — o `@@unique` continua útil pro caso com `serverId` preenchido (esse sim é sempre não-nulo nos dois lados).

## 4. Push notifications

Novo módulo `apps/api/src/push/`, usando `firebase-admin` (dependência nova). Canal único (Firebase Cloud Messaging) pra Android e iOS — FCM entrega pros dois, incluindo ponte com APNs pro iOS, então o backend integra uma coisa só.

- **`push.service.ts`**: `sendToUser(userId, { title, body, data })` — busca todos os `DeviceToken` daquele usuário e manda via `sendEachForMulticast`. Token inválido/expirado (resposta de erro do FCM tipo `UNREGISTERED`) é removido da tabela automaticamente.
- **`push.controller.ts`**: `POST /push/devices` (registra/atualiza token — chamado no login do app e quando o token do FCM rotaciona no cliente), `DELETE /push/devices/:id` (remove no logout).
- O avaliador de alertas (seção 2.3), ao abrir ou resolver uma condição relevante pro usuário, chama `push.service.sendToUser` além de continuar entregando pros canais existentes (Discord/Telegram/webhook) se configurados — é um canal a mais, não uma substituição.

## 5. Endpoints novos

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/push/devices` | Registra/atualiza token de push do dispositivo |
| `DELETE` | `/push/devices/:id` | Remove token (logout) |
| `GET` | `/alerts/thresholds` | Preferência global da pessoa logada |
| `PUT` | `/alerts/thresholds` | Atualiza preferência global |
| `GET` | `/servers/:id/alerts/thresholds` | Override específico daquele servidor (ou o global, se não houver override) |
| `PUT` | `/servers/:id/alerts/thresholds` | Cria/atualiza o override daquele servidor |

`GET /servers/:id/metrics` (já existe) passa a incluir `cpuPercent` e `temperatureCelsius` (ambos `null` quando não suportado) na resposta.

Todas as rotas exigem `JwtAuthGuard`, mesma convenção do resto da API.

## 6. Escopo de container (all vs managed_apps)

`AlertThresholdPreference.dockerScope` decide se eventos de *qualquer* container no servidor disparam alerta (`all`, padrão) ou só os containers ligados a uma Aplicação/Projeto cadastrado no Velix (`managed_apps`). No segundo caso, o watcher casa o `containerId`/nome do evento contra os `ProjectService` conhecidos daquele servidor antes de disparar.

## 7. Segurança e resiliência

- `fcmToken` é único por dispositivo — se o mesmo token aparecer pra um usuário diferente (reinstalação em outra conta no mesmo aparelho), o registro é sobrescrito (upsert por token, não por usuário+plataforma).
- Servidor inacessível: cai na condição "offline" já existente, watcher fica em reconexão com backoff, não derruba a API nem os outros watchers (cada um é isolado).
- Sem sensor de temperatura: detectado uma vez, cacheado em memória por servidor (não persiste no banco — se a API reiniciar, testa de novo uma vez).
- Cooldown de notificação evita flapping (CPU oscilando exatamente no limite) — reaproveita `AlertState`.

## 8. Testes / verificação

- **Avaliador de limites**: teste unitário — dado uma amostra + `AlertThresholdPreference`, dispara/resolve na hora certa, respeita cooldown e a hierarquia servidor→global→desabilitado.
- **Classificador de eventos Docker**: teste unitário — JSON bruto de `docker events` → evento normalizado, respeita o toggle `all` vs `managed_apps`.
- **Resolução de limite efetivo**: teste unitário da função que decide servidor-override vs global vs desabilitado.
- **SSH streaming real não é testável unitariamente** neste ambiente (sem servidor real disponível) — maior risco desta entrega, precisa validação manual contra um servidor de verdade antes de confiar em produção: conexão cai e reconecta corretamente, `sensors` ausente não quebra o watcher, eventos de container batem com o que realmente aconteceu (stop manual vs crash vs restart automático).
- Push: sem servidor real de FCM neste ambiente — testar manualmente com um token de dispositivo real antes de considerar pronto (registro, envio, remoção de token inválido).
