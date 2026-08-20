# App Android — paridade de gestão com o iOS — Design

**Status:** aprovado pelo usuário ("pode fazer tudo") após confirmação de escopo e ordem de fases — sem rodada extra de perguntas de UX, porque este documento não decide UX nova: porta decisões e contratos de API que o app iOS já validou em produção.
**Contexto:** o usuário relatou que "no app a única coisa que consigo fazer é reiniciar ou parar, não consigo ver logs do container, nem ver histórico de implantação". Investigação mostrou que o app iOS já ganhou, em commits recentes ("Fase 1-4 do roteiro de gestão", fora de qualquer spec formal), containers com logs, domínios/SSL, terminal, deploy de novo serviço, e uma aba global de Bancos de Dados com console SQL — mas o Android nunca recebeu nada disso, e ficou preso ao escopo original de `docs/superpowers/specs/2026-08-15-android-app-design.md` (só dashboard, notificações, instâncias e start/stop/restart de projeto). Histórico de implantação (existe no painel web via `DeploymentHistoryCard.tsx` / `GET /applications/:id/deployment-runs`) não existe em **nenhum** dos dois apps — fica fora deste documento, é a próxima frente que o usuário já ordenou separadamente, assim como o polimento visual dos apps nativos.

## 1. Objetivo e não-objetivos

**Objetivo:** levar o app Android (`apps/android`) ao mesmo nível de gestão que o app iOS (`apps/ios`) já tem hoje, reaproveitando exatamente os mesmos endpoints e o mesmo modelo de dados — nenhuma decisão de contrato de API nova, só portar Kotlin/Compose equivalente ao Swift/SwiftUI existente.

**Fora de escopo:**
- Histórico de implantação (não existe em nenhum app ainda — próxima frente, spec própria).
- Polimento visual dos apps nativos (spec própria).
- Publicação nas lojas (sub-projeto 5 do roadmap original, ainda esperando contas de desenvolvedor).
- Qualquer feature que o próprio iOS ainda não tem (ex.: notificação in-app custom, watch app).

## 2. Mapeamento de paridade (o que existe no iOS e falta no Android)

| Área | iOS (já existe) | Android (hoje) | Endpoints reaproveitados |
|---|---|---|---|
| Reiniciar servidor | Botão na Overview (`ServerDetailView`) | Ausente | `POST /servers/:id/reboot` |
| Containers | Aba própria: listar, parar/reiniciar/remover, logs (`ContainersTabView`, `ContainerLogsView`) | Ausente | `GET /servers/:id/docker/status`, `POST .../docker/containers/:id/:action`, `DELETE .../docker/containers/:id`, `GET .../docker/containers/:id/logs?tail=300` |
| Domínios/SSL | Aba própria: listar, adicionar, verificar, remover (`DomainsTabView`) | Ausente | `GET /servers/:id/domains`, `POST /servers/:id/domains`, `GET /domains/:id/verify`, `DELETE /domains/:id` |
| Terminal | Shell interativo via WebSocket (`TerminalView` + `TerminalSocket`), reusado em 3 lugares | Ausente (Android não tem cliente WebSocket) | WS `/servers/:id/terminal` (path varia por contexto — ver Fase 2 e Fase 5) |
| Deploy de novo serviço | Wizard com catálogo, cria o projeto e acompanha o log de deploy ao vivo (`DeployWizardView` + `OpsSocket`) | Ausente | `GET /catalog/applications`, `GET /catalog/applications/:slug`, `POST /applications` (cria o projeto), WS `/ops` com `{type:'start', op:'service-deploy', params}` (log ao vivo) |
| Serviços do projeto | Lista de serviços + detalhe com start/stop/restart/terminal (`ProjectDetailView` → `ProjectServiceDetailView`) | Só start/stop/restart do projeto inteiro, sem lista de serviços | `GET /applications/:id/services`, `POST /applications/:id/services/:name/:action`, WS `/service-terminal` |
| Bancos de dados | Aba global na bottom nav: lista, detalhe com connection info/credenciais/backup config, console SQL (`DatabasesListView`, `DatabaseDetailView`) | Ausente (nenhuma tela) | `GET /databases`, `GET /applications/:id/deployments/:id/connection-info`, `.../credentials`, `GET /databases/:id/backup-config`, WS `/service-terminal?...` com `mode=db` |

## 3. Decisão técnica nova: cliente WebSocket no Android

Duas features dependem de WebSocket e o Android ainda não tem esse cliente: terminal (shell cru, texto solto) e deploy (protocolo JSON `{type, op, params}`/`{type:'log'|'done'}` no canal `/ops`, o mesmo que o painel web usa em `OpsLogPanel`). Duas opções pra base:

- **`ktor-client-websockets`** — plugin oficial do Ktor, mas é uma dependência nova só pra isso.
- **`OkHttp.WebSocket`** — já é dependência transitiva de `ktor.client.okhttp` (o engine que o app já usa pra HTTP). Dá acesso direto a `okhttp3.WebSocket`/`WebSocketListener`, sem adicionar nada ao `build.gradle.kts`.

Vai de OkHttp nativo — cobre os dois casos (conectar, mandar texto, receber texto, fechar) sem dependência extra. Dois clientes finos em cima da mesma base, mesma separação que o iOS já tem:
- `TerminalSocket.kt` (Fase 2): passthrough de texto cru, conecta com `baseUrl` + `path` + `accessToken` (query, já que o handshake de upgrade não aceita header customizado — mesma observação do `OpsSocket.swift`) + `extraQuery`, expõe `Flow<String>` de linhas recebidas e `send(text: String)`.
- `OpsSocket.kt` (Fase 3): sempre conecta em `/ops` com `?token=&serverId=`, manda `{type:'start', op, params}` na abertura, acumula linhas de `{type:'log', data}` e encerra em `{type:'done', ok, error?}` — mesmo protocolo do `OpsSocket.swift`.

## 4. Fases de execução

Cada fase builda e roda no emulador Android já configurado (`Pixel_8`), navega as telas novas, e captura screenshot como evidência — mesmo padrão usado na construção original dos dois apps. Fases sequenciais, cada uma só começa depois da anterior verificada.

**Fase 1 — Reiniciar servidor + Containers.**
- `OverviewContent` (`ServerDetailScreen.kt`): botão "Reiniciar servidor" com diálogo de confirmação (`AlertDialog`), mesmo texto de aviso do iOS.
- Nova aba "Containers" em `ServerDetailScreen` (3ª aba na `NavigationBar` local, ao lado de Visão geral/Projetos): lista containers via `docker/status`, ação parar/reiniciar/remover por linha, navegação pro detalhe de logs.
- Novo `ContainerLogsScreen.kt`: busca `tail=300`, texto monoespaçado rolável, botão atualizar.

**Fase 2 — Domínios + Terminal.**
- `core/TerminalSocket.kt` (ver seção 3) + `features/serverdetail/TerminalScreen.kt` (composable reusável: título, path, query extra — mesma assinatura do `TerminalView` do iOS).
- Nova aba "Domínios" em `ServerDetailScreen`: listar, formulário de adicionar (hostname), verificar (badge de status DNS), remover.
- Nova aba "Terminal" em `ServerDetailScreen`, usando o composable acima com `path = "/servers/:id/terminal"`.

**Fase 3 — Deploy de novo serviço.**
- `core/OpsSocket.kt` (ver seção 3).
- `features/deploy/DeployWizardScreen.kt`: navega catálogo (`/catalog/applications`), detalhe do item selecionado, formulário mínimo (nome do projeto, hostname opcional, variáveis obrigatórias do manifesto). Ao confirmar: `POST /applications` cria o projeto, depois `OpsSocket.start(op = "service-deploy", params = {applicationId, manifestSlug, variables?, domain?})` abre a tela de log ao vivo (texto monoespaçado rolável, mesma UI de `DeployLogView` do iOS) até `done`.
- Botão "Novo serviço" na aba Projetos de `ServerDetailScreen`, abre o wizard e recarrega a lista ao concluir.

**Fase 4 — Bancos de dados.**
- `MainNavHost.kt`: `bottomTabs` ganha um 4º item "Bancos" (ícone Material equivalente ao `cylinder.split.1x2` do iOS — algo como `Icons.Filled.Storage`), nova rota `MainRoute.Databases`.
- `features/databases/DatabasesListScreen.kt`: lista `GET /databases`, agrupada/filtrada por servidor como o iOS faz.
- `features/databases/DatabaseDetailScreen.kt`: connection info, credenciais (com "copiar", ação sensível — não logar em texto claro), link pra config de backup existente, botão "Console SQL" que abre o `TerminalScreen` da Fase 2 com `path = "/service-terminal"` e `mode=db` na query extra.
- Botão "Novo banco" nesta aba reaproveita o `DeployWizardScreen` da Fase 3 com `categoryFilter = "database"`.

**Fase 5 — Serviços do projeto.**
- `ProjectDetailScreen.kt` ganha seção "Serviços" (lista `GET /applications/:id/services`) abaixo das ações atuais de start/stop/restart do projeto.
- Novo `ProjectServiceDetailScreen.kt`: status, imagem (mono), start/stop/restart por serviço, botão "Abrir terminal" usando o `TerminalScreen` com `path = "/service-terminal"` (sem `mode`, cai no shell — diferente do console SQL da Fase 4, que manda `mode=db`).

## 5. O que NÃO muda

- Arquitetura geral do app (sem DI framework, `AppSession`/`CompositionLocal`, Ktor+`kotlinx.serialization` pra REST, `EncryptedSharedPreferences` pro token) — só estende o que já existe.
- Estrutura de instância múltipla, onboarding, notificações — intocados.
- Nenhuma decisão de contrato de API nova: tudo aqui já está em produção servindo o app iOS.

## 6. Risco e mitigação

O risco não é de design (já provado pelo iOS) — é de **regressão de contrato específica de Kotlin**, como as três lições que a spec original do Android já documentou (`docker/status` é objeto não lista; 2FA vem como erro 401, não sucesso; campo desligado precisa virar `null` explícito no JSON, checar `explicitNulls`). A mesma classe de armadilha pode aparecer aqui em contratos ainda não exercitados pelo Android (ex.: payload de criar domínio, payload do wizard de deploy) — mitigação: ao implementar cada fase, conferir o `Models.swift`/chamada real do iOS lado a lado com o `Models.kt` equivalente antes de assumir que a serialização bate.
