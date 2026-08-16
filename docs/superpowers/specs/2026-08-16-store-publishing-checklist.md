# Publicação nas lojas (App Store + Play Store) — Checklist

**Status:** sub-projeto 5 de 5. Diferente dos anteriores, a maior parte daqui só o usuário pode fazer — criar conta de desenvolvedor e pagar as taxas são ações que exigem identidade/pagamento pessoal, fora do que um agente pode executar. Este documento existe pra deixar claro exatamente o que falta e em que ordem.

## O que já está pronto

- App iOS nativo completo (11 tasks + correção de crash do Firebase), builda e roda sem erro no simulador, ícone real aplicado.
- App Android nativo completo (11 tasks), builda e roda sem erro no emulador, ícone real aplicado.
- Backend com toda a infraestrutura que os apps precisam: JWT+2FA, monitoramento em tempo real, push (Firebase), limites de alerta configuráveis por pessoa.
- Identidade visual (logo, ícones) já usada nos dois apps e no painel web.

## O que só você pode fazer (contas e pagamento)

1. **Conta Apple Developer Program** — developer.apple.com, taxa anual (~US$99). Necessária pra gerar certificado de assinatura, provisionar o app num dispositivo real, e submeter à App Store.
2. **Conta Google Play Console** — play.google.com/console, taxa única (~US$25). Necessária pra gerar a chave de assinatura (keystore) de release e publicar na Play Store.
3. **Projeto Firebase** — console.firebase.google.com, gratuito. Necessário pros dois apps mandarem/receberem push de verdade (hoje os dois já detectam a ausência de configuração e simplesmente não travam, mas push não funciona sem isso). Ao criar:
   - iOS: baixar `GoogleService-Info.plist` e colocar em `apps/ios/Velix/`.
   - Android: baixar `google-services.json` e colocar em `apps/android/app/`.
   - Backend: gerar a chave de conta de serviço (Configurações do projeto → Contas de serviço → Gerar nova chave privada) e configurar `FIREBASE_SERVICE_ACCOUNT_JSON` no `.env` do Velix (ver nota abaixo sobre isso não sobreviver a atualizações do instalador).

## Depois de ter as contas — o que eu (ou um agente futuro) posso preparar

Cada um destes vira uma task concreta quando você tiver as contas acima:

- **Bundle ID / Application ID definitivo**: hoje ambos os apps usam `com.velix.app` como provisório. Precisa bater com o identificador registrado na conta Apple/Google (geralmente o mesmo, mas confirme).
- **Assinatura de release**:
  - iOS: certificado de distribuição + perfil de provisionamento, configurados no Xcode/`project.yml`.
  - Android: gerar um keystore de release (`keytool -genkeypair`) e configurar `signingConfigs` no `app/build.gradle.kts` — hoje só existe build de debug.
- **Metadados da loja**: descrição, categoria, screenshots (posso gerar screenshots reais dos simuladores/emuladores uma vez que haja um backend de teste pra navegar telas com dado real, não só formulário vazio), política de privacidade (obrigatória nas duas lojas — posso rascunhar uma).
- **Build de release** (`xcodebuild archive` / `./gradlew bundleRelease`) e upload via Xcode Organizer / Google Play Console.
- **Revisão da Apple/Google**: fora do nosso controle depois do envio — pode levar de horas a alguns dias.

## Item já sinalizado no backend

`FIREBASE_SERVICE_ACCOUNT_JSON` foi adicionado ao `docker-compose.yml`, mas **não** ao gerador de `.env` do instalador (`install.sh`) — esse arquivo é reescrito do zero a cada instalação/atualização do Velix, então a chave configurada manualmente seria apagada na próxima atualização, a menos que alguém adicione preservação dela em `install.sh` (mesmo padrão já usado pra `CF_DNS_API_TOKEN`). Vale resolver antes de depender de push em produção por muito tempo.

## Resumo do estado

| Sub-projeto | Status |
|---|---|
| 1. Backend (monitoramento + push) | ✅ Completo, revisado, testado |
| 2. Produto/UX compartilhada | ✅ Completo (spec) |
| 3. App iOS nativo | ✅ Completo, revisado, roda no simulador |
| 4. App Android nativo | ✅ Completo, revisado, roda no emulador |
| 5. Publicação nas lojas | ⏸️ Aguardando contas de desenvolvedor (Apple/Google/Firebase) — ação do usuário |
