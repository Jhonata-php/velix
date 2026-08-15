# App iOS nativo — Design

**Status:** decisões tomadas de forma autônoma a pedido explícito do usuário ("pode continuar até o final agora sem parar") — sem rodada de perguntas.
**Contexto:** sub-projeto 3 de 5. Segue a experiência definida em `docs/superpowers/specs/2026-08-15-mobile-app-product-ux-design.md` (telas, fluxo, decisão de multi-instância). Este documento é só as decisões técnicas específicas de iOS.

## 1. Objetivo e não-objetivos

**Objetivo:** app iOS nativo (SwiftUI) implementando as seis telas da spec de UX (onboarding, login+2FA, dashboard, detalhe do servidor, notificações, instâncias), rodando no simulador pra verificação visual real durante o desenvolvimento.

**Fora do escopo:** publicação na App Store (sub-projeto 5 — precisa de conta de desenvolvedor Apple, que só o usuário pode criar/pagar). App Clips, widgets, watchOS. Testes de UI automatizados (XCUITest) — verificação visual via simulador cobre esta fase; testes unitários (XCTest) cobrem lógica pura.

## 2. Stack e decisões técnicas

- **Swift 6 + SwiftUI**, iOS mínimo **17.0** — dá acesso à macro `@Observable` (state management sem boilerplate de `Combine`/`ObservableObject`) e ao framework `Charts` (nativo, sem dependência de terceiro pra gráfico de linha do histórico de métricas). iOS 17 já tem adoção alta o bastante pra não valer a pena suportar 16 só por um ponto a mais de alcance.
- **Rede**: `URLSession` + `async/await` + `Codable` — sem Alamofire. A API do Velix é um punhado de rotas REST simples; `URLSession` nativo cobre sem precisar de dependência.
- **Armazenamento seguro do token**: Keychain via `Security` framework direto (um wrapper pequeno, `KeychainStore.swift`) — sem biblioteca de terceiro pra isso, é a própria API que a Apple recomenda.
- **Push**: Firebase Cloud Messaging (`FirebaseMessaging`, via Swift Package Manager) — decisão já tomada no backend (canal único FCM pra Android+iOS). O app registra pro APNs primeiro (`UNUserNotificationCenter`), recebe o token da Apple, entrega pro Firebase SDK, que devolve o token FCM que vai pro `POST /push/devices`.
- **Gráfico de histórico**: `Charts` (nativo).
- **Injeção de dependência**: nenhum framework — `@Environment` do SwiftUI mais um objeto `AppSession` (`@Observable`) injetado na raiz, cobre o caso de uso sem precisar de container de DI.

## 3. Estrutura de arquivos

```
apps/ios/Velix/
  VelixApp.swift                 — @main, monta AppSession, decide tela inicial
  Core/
    APIClient.swift              — cliente REST genérico (GET/POST/PUT/DELETE, injeta Bearer token, decodifica erros)
    Models.swift                 — DTOs Codable (LoginResponse, ServerSummary, ServerMetrics, AlertThresholdPreference, etc.) espelhando os DTOs do backend
    KeychainStore.swift          — wrapper de Keychain (save/read/delete por chave)
    Instance.swift                — modelo de instância local (baseUrl, token, e-mail) + InstanceStore (persistência em Keychain, lista de instâncias)
    AppSession.swift             — @Observable, estado global: instância ativa, usuário logado, navegação de alto nível
    PushManager.swift            — registro APNs → FCM → POST /push/devices, roteamento de deep link ao tocar notificação
  Features/
    Onboarding/
      AddInstanceView.swift      — campo de domínio + validação de alcance
      LoginView.swift            — e-mail/senha + "lembrar de mim"
      TwoFactorView.swift        — código de 6 dígitos + link "usar código de recuperação"
    Dashboard/
      DashboardView.swift        — lista de servidores da instância ativa
      ServerRow.swift            — uma linha (nome, status, CPU/mem/temp mini)
    ServerDetail/
      ServerDetailView.swift     — métricas + gráfico (Charts) + lista de containers
    Notifications/
      NotificationSettingsView.swift — bloco global + lista de overrides por servidor
      ThresholdEditorView.swift  — editor reusado pro bloco global e pro override (mesmo componente, contexto diferente)
    Instances/
      InstanceListView.swift     — trocar/adicionar/remover instância
  VelixTests/
    APIClientTests.swift
    KeychainStoreTests.swift
    InstanceStoreTests.swift
```

## 4. Fluxo de navegação

`VelixApp` decide a raiz: sem nenhuma instância → `AddInstanceView` (empilha `LoginView` → `TwoFactorView` quando preciso); com ao menos uma instância → `DashboardView` como raiz de uma `TabView` (abas: Dashboard, Notificações, Conta/Instâncias). `NavigationStack` dentro da aba Dashboard leva a `ServerDetailView`. Deep link de push (`data.serverId`) empurra direto pra `ServerDetailView` daquele servidor, trocando a instância ativa primeiro se o push veio de uma instância diferente da que está em primeiro plano (ver seção 7 da spec de UX sobre token por instância).

## 5. Modelo de instância e token por push (resolve a seção 7 da spec de UX)

Cada `Instance` registra seu próprio token lógico: no login, `PushManager` pede o token FCM real do SO uma vez (é o mesmo pro aparelho todo) e associa esse mesmo token físico a cada instância via uma chamada própria de `POST /push/devices` por instância — o backend já trata isso corretamente porque `DeviceToken.fcmToken` é `@unique` por linha, mas cada instância roda sua própria API/banco, então a mesma pessoa logada em duas instâncias diferentes já gera duas linhas de `DeviceToken` automaticamente (uma em cada backend), sem precisar de nada extra do lado do servidor. O app só precisa registrar de novo a cada instância adicionada — não reusar silenciosamente.

## 6. Testes

`XCTest` (roda via `xcodebuild test`) cobre lógica pura sem UI:
- `APIClientTests`: parsing de resposta de sucesso/erro, montagem de request com Bearer token.
- `KeychainStoreTests`: save/read/delete via o Keychain real do simulador (não precisa de mock — o simulador tem Keychain funcional).
- `InstanceStoreTests`: adicionar/remover/trocar instância ativa, persistência.

Verificação visual: build + rodar no simulador (`iPhone 16`, disponível nesta máquina), navegar as telas principais, tirar screenshot de cada uma como evidência.

## 7. Bundle ID e nome

`com.velix.app` como bundle identifier provisório — o usuário provavelmente vai precisar ajustar pro Team ID real da conta de desenvolvedor Apple quando configurar a publicação (sub-projeto 5); não é uma decisão que trava nada até lá. Nome do app: "Velix".
