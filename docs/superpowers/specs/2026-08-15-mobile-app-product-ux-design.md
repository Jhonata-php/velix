# Apps móveis Velix — Produto e UX compartilhada — Design

**Status:** decisões tomadas de forma autônoma a pedido explícito do usuário ("pode continuar até o final agora sem parar") — sem rodada de perguntas. Documentado aqui pra revisão posterior, não pra aprovação prévia.
**Contexto:** sub-projeto 2 de 5 do roadmap combinado com o usuário (ver `docs/superpowers/specs/2026-08-14-mobile-push-monitoring-backend-design.md`, seção de contexto). O backend (sub-projeto 1) já está pronto: JWT+2FA, `/servers`, métricas com CPU%/temperatura, `/push/devices`, `/alerts/thresholds`. Este documento define a experiência comum aos dois apps nativos (iOS e Android) — telas, fluxo, modelo de dados do cliente — que as specs de implementação de cada plataforma (sub-projetos 3 e 4) vão seguir. Não é um spec de código; não gera plano de implementação próprio.

## 1. Objetivo e não-objetivos

**Objetivo:** um app "Velix" nativo (iOS e Android), minimalista e intuitivo, que resolve exatamente o que o usuário pediu: abrir o app, indicar o domínio da instância do Velix, logar (com 2FA quando ativado), ver os servidores sincronizados, e configurar quando quer ser avisado — recebendo push de temperatura alta, CPU, memória e problema em container (parou/reiniciou), tudo configurável pela própria pessoa.

**Fora do escopo desta fase:**
- Ações de escrita nos servidores (deploy, restart de container, editar configuração) — o app é de monitoramento e notificação, não um painel de administração completo. Abrir o site em uma WebView/browser externo pra ações avançadas fica como válvula de escape, não uma tela nativa dedicada.
- Terminal/SSH web embutido, editor de banco de dados, gerenciamento de usuários — ficam só no painel web.
- Onboarding de criar conta nova pelo app (registro) — o app sempre loga numa conta que já existe, criada pelo painel web.
- Widgets de tela inicial, watch app, tablet layout dedicado — podem vir depois, não bloqueiam o lançamento.

## 2. Decisão central: "multi-servidor" no app = múltiplas instâncias do Velix

O levantamento do backend (sub-projeto 1) já esclareceu: dentro de uma única instalação do Velix, "múltiplos servidores" já é só a lista `GET /servers` de uma API só. O pedido original do usuário — "quando a pessoa inicia, coloca o domínio ai sincroniza o servidor" — descreve o app se conectando a **uma instância do Velix por domínio**. Ou seja, o "multi" que interessa no app não é dentro de uma instância (isso o backend já resolve), é o app suportar **múltiplas instâncias Velix logadas ao mesmo tempo** (ex.: a pessoa administra o Velix de duas empresas diferentes, cada uma no seu domínio) — cada instância com seu próprio login, seu próprio token, sua própria lista de servidores.

Isso vira a estrutura de dados central do cliente:

```
Instance { id, baseUrl, displayName (deduzido do domínio), userEmail, accessToken (armazenamento seguro), lastSyncedAt }
```

Uma pessoa pode ter 1 instância (caso comum) ou várias. A UI só mostra o seletor de instância quando há mais de uma — com uma só, some da experiência (sem aba/menu vazio pra um caso que não existe).

## 3. Fluxo de onboarding

1. **Splash** — logo Velix (`logo.png`/mark, já criado), sem spinner artificial, some assim que o app decide pra onde ir.
2. **Sem instância nenhuma cadastrada** → tela "Adicionar Velix": campo de domínio (ex.: `painel.suaempresa.com`, aceita com ou sem `https://`), botão "Continuar". Valida alcançável fazendo um `GET` simples no domínio informado antes de avançar (endpoint de saúde/login da API) — erro claro se não responder ("não consegui alcançar esse endereço, confere o domínio").
3. **Login** — e-mail + senha, "Lembrar de mim" (equivalente ao `rememberMe` do backend, que já dá token de 30 dias em vez de 12h). Reaproveita exatamente o contrato de `POST /auth/login` que já existe.
4. **2FA** (só se a resposta do login pedir) — código de 6 dígitos (autofill do SMS/authenticator quando o SO oferecer), com alternativa "usar código de recuperação" — mesmo par de opções que a tela web já tem (`OtpInput` + fallback de recovery code em `apps/web/components/auth/OtpInput.tsx` como referência de comportamento, não de UI).
5. **Registro do token de push** — assim que autentica, chama `POST /push/devices` com o token do sistema (APNs/FCM) e a plataforma. Silencioso — sem tela própria, sem pedir permissão de notificação ainda (isso só é pedido na primeira vez que a pessoa abrir a tela de notificações, ver seção 6, pra não assustar com um pedido de permissão na cara antes de mostrar valor).
6. Cai no **Dashboard** dessa instância. Se a pessoa quiser adicionar outra instância depois, faz pelo menu (não faz parte do onboarding de novo).

Logout remove a instância da lista local e chama `DELETE /push/devices/:id` daquele dispositivo (evita continuar recebendo push de uma conta que a pessoa saiu).

## 4. Telas principais (por instância ativa)

### 4.1 Dashboard
Lista dos servidores (`GET /servers`), cada linha: nome, status (online/offline via bolinha colorida, mesmo padrão do `StatusBadge` web), CPU%/memória%/temperatura em miniatura quando disponíveis (podem faltar — nem todo servidor tem sensor de temperatura, ver spec do backend). Pull-to-refresh. Sem streaming ao vivo dentro do app nesta fase — atualiza sob demanda e ao entrar em foreground, como o próprio painel web já faz (evita reimplementar uma conexão persistente cliente↔API só pra isso, quando o push já cobre "algo mudou" e o pull-to-refresh cobre "quero ver agora").

### 4.2 Detalhe do servidor
Métricas com histórico (`GET /servers/:id/metrics/history`) em gráfico simples de linha (CPU/memória/temperatura, últimas horas), lista de containers com status, e um atalho pra abrir o painel web completo daquele servidor numa aba externa (não WebView embutida — abre no navegador do sistema) pra quem precisar de uma ação que o app não cobre.

### 4.3 Notificações (configuração)
Espelha exatamente `AlertThresholdPreference`: um bloco "Padrão" (aplica a todos os servidores que não têm override) com os campos que já existem no backend — limite de CPU%, memória%, temperatura°C (cada um com toggle de habilitado/desabilitado, não só um número), e o bloco de container (ligar/desligar, "todos os containers" vs "só minhas aplicações"). Por servidor, a mesma tela em modo "override" com um botão "usar o padrão" pra remover o override e voltar a herdar do global. Pede permissão de notificação do sistema na primeira vez que a pessoa abre essa tela (ver seção 3) — é o primeiro momento em que negar a permissão tem uma consequência óbvia e contextual.

### 4.4 Conta / instâncias
Lista de instâncias logadas com opção de trocar a ativa, adicionar outra (reaproveita o fluxo da seção 3 a partir do passo 2), remover uma. Dados da conta (nome, e-mail, 2FA ativo/inativo — só leitura, gerenciar 2FA continua no painel web nesta fase).

## 5. Push notification — payload e ação ao tocar

O backend (sub-projeto 1) já manda `{ title, body, data: { serverId, metric? / containerId? } }`. Tocar na notificação abre o app direto na tela de Detalhe do servidor (seção 4.2) daquele `serverId`, na instância correta (o `data` payload precisa carregar também qual instância — acrescentar `instanceBaseUrl` ou um identificador de instância ao payload é uma alteração pequena no backend que as specs de implementação do app devem sinalizar como dependência, já que hoje o payload não distingue de qual instância veio um push, o que quebra o deep link pra quem tem mais de uma instância logada). Notificação em foreground: banner nativo do SO (iOS `UNNotificationPresentationOptions`, Android `NotificationChannel` com importância alta), sem tela de notificação in-app custom nesta fase.

## 6. Identidade visual

Reaproveita os assets já criados pro painel web: mark roxo (`#7C3AED`-ish) sobre fundo claro/transparente, wordmark branco para fundos escuros — mesmos arquivos-fonte de `apps/web/public/logo*.png`, exportados nos tamanhos nativos de cada plataforma (ícone de app, splash) pelas specs de implementação. Suporte a modo claro/escuro do sistema em ambos os apps (não um toggle manual — seguir o SO, mesmo padrão do painel web que usa `next-themes` com `attribute="class"`). Tipografia e componentes nativos de cada plataforma (SwiftUI padrão no iOS, Material 3 no Android) — não uma tentativa de replicar pixel a pixel o CSS do painel web, que é uma linguagem visual de outra plataforma.

## 7. Dependência nova no backend (fora do escopo deste documento, sinalizada aqui)

A seção 5 identificou que o payload de push atual não carrega identificador de instância — não é ambíguo hoje (uma API só existe), mas fica ambíguo no cliente assim que uma pessoa loga em duas instâncias diferentes que compartilham o mesmo usuário/e-mail (não há de fato uma "instância" no lado do servidor, é um conceito só do cliente). A resolução mais simples: o app usa a própria `baseUrl` da instância que recebeu o push como identificador — como cada instância tem sua própria fila de tokens de dispositivo (o FCM/APNs token é o mesmo aparelho, mas `POST /push/devices` é chamado uma vez por instância logada, criando uma linha de `DeviceToken` por instância no banco de cada backend), o push que chega já "sabe" de qual API veio, sem precisar de campo novo — mas só se o app usa **tokens de push diferentes por instância** (regenerar/registrar um token lógico por instância no momento de login, não reusar o mesmo token do SO cruamente). Isso é uma decisão de implementação do cliente, não do backend — anotado aqui pra não se perder entre os specs de iOS e Android, que precisam implementar isso de forma consistente entre si.
