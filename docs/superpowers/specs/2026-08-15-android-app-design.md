# App Android nativo — Design

**Status:** decisões tomadas de forma autônoma a pedido explícito do usuário ("pode continuar até o final agora sem parar") — sem rodada de perguntas.
**Contexto:** sub-projeto 4 de 5. Segue a experiência definida em `docs/superpowers/specs/2026-08-15-mobile-app-product-ux-design.md` (telas, fluxo, decisão de multi-instância) e espelha as mesmas seis telas do app iOS (`docs/superpowers/specs/2026-08-15-ios-app-design.md`), adaptadas pra Android/Kotlin/Compose.

## 1. Objetivo e não-objetivos

Mesmos da spec iOS (seção 1), adaptados: **objetivo** é o app Android nativo (Kotlin, Jetpack Compose) com as seis telas da spec de UX, rodando no emulador (`Pixel_8`, já configurado nesta máquina) pra verificação real. **Fora do escopo**: publicação na Play Store (sub-projeto 5 — precisa de conta de desenvolvedor Google, só o usuário pode criar/pagar), testes de UI instrumentados (Espresso/Compose UI Test) — verificação visual via emulador cobre esta fase, testes unitários JVM cobrem lógica pura.

## 2. Lições do app iOS aplicadas de antemão

O app iOS (sub-projeto 3, já concluído) revelou três problemas reais durante a implementação que valem a pena evitar aqui de saída, em vez de descobrir de novo:

1. **Contrato real do Docker**: `GET /servers/:id/docker/status` (não `/servers/:id/docker`) devolve `{ installed: Bool, version: String?, containers: [ContainerStatus]? }` — um objeto, não uma lista solta. Usar esse contrato desde o início.
2. **2FA vem como erro, não sucesso**: o backend retorna `totp_required`/`totp_invalid` no corpo de um HTTP 401 (`{ message, reason }`), nunca como parte de uma resposta 200. A lógica de detecção de 2FA tem que ficar no tratamento de erro da chamada de login, não num campo de uma resposta bem-sucedida.
3. **Campo desabilitado precisa virar `null` explícito no JSON, não desaparecer**: ao desligar um limite de alerta (CPU/memória/temperatura) e salvar, o corpo da requisição PUT precisa mandar `"cpuPercent": null` de verdade — se a chave simplesmente sumir do JSON, o backend interpreta como "não mexe nesse campo" e o valor antigo continua lá. Em Kotlin/`kotlinx.serialization`, isso tende a já vir certo por padrão (ao contrário do `Codable` do Swift, que omite `nil` por padrão) — mas **confirmar explicitamente** que `explicitNulls` não foi desligado em nenhum `Json { }` builder usado nas chamadas de salvar limites, já que é exatamente o tipo de configuração que quebra isso silenciosamente.
4. **Firebase sem config trava o app**: no iOS, `FirebaseApp.configure()` sem `GoogleService-Info.plist` derruba o app inteiro com uma exceção, não só o push — só foi descoberto na verificação final. No Android, o comportamento é diferente mas igualmente traiçoeiro: o **plugin Gradle `com.google.gms.google-services` falha o build inteiro** se `google-services.json` não existir, quando o plugin está aplicado incondicionalmente. Este projeto **não vai ter um `google-services.json` real** (precisa de um projeto Firebase de verdade, que o usuário ainda não criou) até o sub-projeto 5. Solução: aplicar o plugin do Google Services **condicionalmente** (só se o arquivo existir no momento do build) e, no código, checar se o Firebase foi inicializado antes de qualquer chamada a `FirebaseMessaging`/`Firebase.messaging`, no mesmo espírito do guard feito no iOS — ver seção 6.

## 3. Stack e decisões técnicas

- **Kotlin + Jetpack Compose**, Material 3. `minSdk 26` (Android 8.0 — cobertura ampla, ainda dá acesso a `NotificationChannel` moderno), `compileSdk`/`targetSdk 35` (versão estável mais recente confirmada instalada nesta máquina).
- **Rede**: `Ktor Client` (motor Android/OkHttp) + `kotlinx.serialization` — biblioteca já oficial do ecossistema Kotlin, sem precisar de Retrofit+Gson+OkHttp como três dependências separadas quando uma cobre tudo.
- **Armazenamento seguro do token**: `EncryptedSharedPreferences` (parte do `androidx.security:security-crypto`, biblioteca oficial do Android Jetpack) — equivalente ao Keychain do iOS, sem dependência de terceiro.
- **Push**: Firebase Cloud Messaging (`com.google.firebase:firebase-messaging-ktx`) — mesma decisão do backend e do iOS (canal único FCM). Ver seção 6 pro tratamento de "sem config".
- **Gráfico de histórico**: [Vico](https://github.com/patrykandpatrick/vico) — única exceção a "nativo primeiro" nesta stack: Compose não tem um framework de gráficos nativo equivalente ao `Charts` do SwiftUI. Vico é enxuto (só o módulo de gráfico de linha), ativamente mantido, e evita reimplementar renderização de gráfico do zero.
- **Injeção de dependência**: nenhum framework (nem Hilt/Koin) — um objeto `AppSession` simples, exposto via `CompositionLocal`, cobre o caso de uso sem precisar de um container de DI, mesma decisão do iOS.
- **Concorrência**: Kotlin Coroutines + `Flow` (já parte do toolchain padrão, não uma dependência extra).

## 4. Estrutura de módulos/pacotes

```
apps/android/app/src/main/java/com/velix/app/
  VelixApplication.kt            — Application, inicializa Firebase condicionalmente
  MainActivity.kt                — ComponentActivity, monta AppSession, decide tela inicial
  core/
    ApiClient.kt                 — cliente REST (Ktor), injeta Bearer token, decodifica erros
    Models.kt                    — data classes @Serializable espelhando os DTOs do backend
    SecureStore.kt                — wrapper de EncryptedSharedPreferences
    Instance.kt                  — modelo de instância + InstanceStore (persistência, lista)
    AppSession.kt                 — estado global: instância ativa, navegação de alto nível
    PushManager.kt                — registro FCM → POST /push/devices, roteamento de deep link
  features/
    onboarding/
      AddInstanceScreen.kt        — campo de domínio + validação de alcance
      LoginScreen.kt               — e-mail/senha + "lembrar de mim"
      TwoFactorScreen.kt           — código de 6 dígitos + "usar código de recuperação"
    dashboard/
      DashboardScreen.kt           — lista de servidores da instância ativa
      ServerRow.kt                 — uma linha (nome, status, CPU/mem/temp mini)
    serverdetail/
      ServerDetailScreen.kt        — métricas + gráfico (Vico) + lista de containers
    notifications/
      NotificationSettingsScreen.kt — bloco global + lista de overrides por servidor
      ThresholdEditor.kt            — composable reusado pro bloco global e pro override
    instances/
      InstanceListScreen.kt         — trocar/adicionar/remover instância
  ui/theme/                        — cores (roxo Velix, mesmo tom do iOS/web), tipografia Material 3
apps/android/app/src/test/java/com/velix/app/
  ApiClientTest.kt
  SecureStoreTest.kt
  InstanceStoreTest.kt
```

## 5. Fluxo de navegação

`MainActivity` decide a tela inicial via Compose Navigation (`NavHost`): sem nenhuma instância → grafo de onboarding (`AddInstanceScreen` → `LoginScreen` → `TwoFactorScreen`); com ao menos uma → um `NavigationBar` (bottom nav, equivalente Android da `TabView` do iOS) com 3 destinos: Dashboard, Notificações, Conta. Navegação pro detalhe do servidor a partir da lista, e a tela de "adicionar instância" a partir de Conta abre o grafo de onboarding como uma nova rota empilhada (não precisa do equivalente a "sheet" do iOS — Android Navigation já lida bem com pilhas de rota simples aqui, sem a armadilha de contexto que o `dismiss()` do SwiftUI teve no iOS: navegação Android via `NavController.popBackStack()` sempre volta exatamente pra rota anterior na mesma pilha, sem ambiguidade de "qual contexto" — mas o retorno ainda precisa ser explícito via callback/lambda de conclusão, mesma lição da correção do iOS, não por engano assumir que "voltar" acontece sozinho).

## 6. Push e o guard do Firebase (resolve a lição da seção 2, item 4)

`app/build.gradle.kts`: o plugin `id("com.google.gms.google-services")` só é aplicado se `File("google-services.json").exists()` for verdadeiro no momento da avaliação do Gradle — assim o build não falha na ausência do arquivo. Em `VelixApplication.onCreate()`, o app checa se o Firebase foi de fato inicializado (`FirebaseApp.getApps(this).isNotEmpty()`, que só é verdade se o plugin rodou com um `google-services.json` válido) antes de qualquer chamada a `Firebase.messaging`; se não foi, loga e segue sem push, mesmo espírito do guard do iOS. `PushManager.registerCurrentToken` repete a mesma checagem antes de chamar `FirebaseMessaging.getInstance().token`.

## 7. Testes

JVM unit tests (`./gradlew test`, sem precisar de emulador) cobrem lógica pura:
- `ApiClientTest`: parsing de sucesso/erro, montagem de request com Bearer token, e especificamente um teste que serializa um limite de alerta com campo desabilitado e confirma que o JSON resultante tem `"cpuPercent":null` (não a chave ausente) — trava a lição #3 da seção 2 com um teste, não só um comentário.
- `SecureStoreTest`: save/read/delete.
- `InstanceStoreTest`: adicionar/remover/trocar instância ativa, persistência.

Verificação visual: build + rodar no emulador `Pixel_8` (já configurado nesta máquina), navegar as telas principais, capturar screenshot de cada uma como evidência — mesmo padrão do iOS.

## 8. Nome do pacote e nome do app

`com.velix.app` como `applicationId` (mesmo domínio reverso do bundle ID do iOS, por consistência entre as duas lojas). Nome do app: "Velix".
