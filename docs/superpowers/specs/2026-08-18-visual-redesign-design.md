# Redesign visual do painel web — Design

**Status:** aprovado pelo usuário após comparação de 3 mockups (minimalista flat / elevado suave / denso-técnico) — escolheu o denso-técnico, estilo EasyPanel/Coolify, "quero ficar bem top e bonito", aplicado ao sistema inteiro.
**Contexto:** o usuário relatou que o painel "visualmente não tá legal, os cards e tudo mais não tá profissional". Investigação mostrou que a paleta de cor já está correta (`tailwind.config.ts` sobrescreve slate/indigo com os tokens de marca do Velix — quase-preto + violeta) — o problema é a linguagem de forma: sombra, gradiente e arredondamento generosos lêem como "app de consumidor", não como ferramenta técnica de infraestrutura.

## 1. Objetivo e não-objetivos

**Objetivo:** aplicar uma linguagem visual mais densa, plana e técnica — inspirada em EasyPanel/Coolify — em todo o painel web (`apps/web`), sem trocar a paleta de cor de marca (violeta/quase-preto continuam).

**Fora de escopo:**
- Trocar biblioteca de ícones (o conjunto próprio em `components/icons.tsx` já é consistente e suficiente — só muda ONDE/COMO é usado, não o que é).
- Trocar paleta de cor (slate/indigo do `tailwind.config.ts` permanecem).
- Apps nativos (iOS/Android) — usam linguagem visual própria de cada plataforma, fora deste documento.
- Reestruturar informação/fluxo de nenhuma tela — é um redesign visual, não funcional.

## 2. O que muda, na prática

### 2.1 Cards e superfícies
`.card` hoje (`app/globals.css`) usa `box-shadow` em duas camadas pra dar profundidade. Vira: fundo sólido (`bg-white dark:bg-slate-900`, sem mudança) + borda de 1px só, **sem `box-shadow`**. `.card-hover` perde o `-translate-y-0.5` (efeito de "levantar" o card) — no lugar, só clareia a borda. `.surface-elevated` idem, sem sombra.

Arredondamento desce um degrau: `rounded-xl` (12px) → `rounded-lg` (8px) nas classes compartilhadas. Não é uma regra absoluta pixel-a-pixel em cada componente — é a direção: cantos mais retos, menos "pilula".

### 2.2 Botões
`.btn-primary` hoje é gradiente (`from-indigo-500 to-indigo-600`) com sombra de glow colorido. Vira sólido: `bg-indigo-600`, hover `bg-indigo-500`, sem gradiente, sem glow — só a sombra de contato mínima que qualquer botão tem (`shadow-sm` ou nem isso). `.btn-secondary`, `.btn-danger`, `.btn-ghost` já são planos hoje — mantêm.

### 2.3 Densidade
Reduz padding em cards e linhas de lista um degrau (ex.: `p-5`→`p-4`, `p-4`→`p-3.5`, `py-3`→`py-2.5` em linhas de tabela/lista). Objetivo: mais conteúdo visível por tela sem paginar/rolar tanto. Não se aplica a formulários/modais de entrada de dado (onde espaço de toque e legibilidade importam mais que densidade).

### 2.4 Tipografia técnica
Generaliza o uso de `font-mono` (já existe pontualmente em senha/string de conexão) pra todo dado técnico: porta, versão de imagem, IP, nome de container, slug de projeto, SHA de commit. Regra prática: se o dado é algo que o usuário copiaria e colaria num terminal, é mono.

### 2.5 Status em linha de lista
Padrão novo pra linhas de lista/tabela (projetos, serviços, domínios, execuções de backup): borda lateral esquerda de 3px na cor do status (verde/vermelho/âmbar/cinza) + rótulo de texto curto na mesma cor, em vez do badge-pílula isolado que hoje aparece em toda linha.

O badge-pílula (`.badge`) continua existindo — mas passa a ser reservado pra contexto de resumo/cabeçalho (ex.: status no topo de uma tela de detalhe), onde só texto colorido teria pouco peso visual sozinho.

### 2.6 Ícones
Sem trocar o conjunto. Muda o uso: `.icon-chip` (círculo com fundo tintado ao redor do ícone) sai de listas — ali o ícone fica solto, cinza neutro (`text-slate-400`). O chip tintado fica reservado pra cabeçalho de página e estado vazio (`EmptyState`), onde still faz sentido chamar atenção.

### 2.7 Modais
`Modal.tsx` recebe o mesmo tratamento de `.card`: sem sombra pesada, borda fina, cabeçalho compacto (reduz padding vertical do título).

## 3. O que NÃO muda

- Paleta de cor (slate/indigo do `tailwind.config.ts`).
- Dark/light mode — continuam os dois, com os mesmos pontos de alternância (`next-themes`, `attribute="class"`).
- Ícones (conjunto próprio, só uso).
- Estrutura de navegação, abas, fluxos.
- Animações de tela de login/atualização (`globals.css` — blobs, rede, OTP) — são elementos de "momento especial" (login, update), não do dia a dia do painel; ficam fora do escopo denso-técnico.

## 4. Execução em duas fases

**Fase 1 — Fundação.** Reescreve as classes compartilhadas em `app/globals.css` (`.card`, `.card-hover`, `.surface-elevated`, `.btn-primary`, `.badge`, `.tab-pill`) e os componentes-base reusados em quase toda tela: `Modal.tsx`, `StatusBadge.tsx`, `Alert.tsx`, `EmptyState.tsx`. Como a grande maioria das telas já usa essas classes/componentes em vez de estilo solto, essa fase sozinha já muda a aparência de boa parte do painel sem tocar em cada arquivo de tela.

**Fase 2 — Varredura.** Passa tela por tela (projetos, serviços, bancos de dados, servidores, configurações, atualizações, login) aplicando:
- o novo padrão de borda-lateral-de-status em toda lista/tabela que hoje só usa badge-pílula;
- `font-mono` em todo dado técnico que ainda não tem;
- qualquer elemento com estilo inline solto (não usando `.card`/`.btn-*`) que precise ser alinhado manualmente ao padrão novo.

Ordem sugerida pra Fase 2 (mais visitado → menos visitado, mesmo critério já usado na sessão anterior): Bancos de Dados → Projetos/Serviços → Servidores → Configurações → telas restantes.

## 5. Risco e mitigação

Mudar classes compartilhadas em `globals.css` tem raio de alcance grande (toda tela que usa `.card`/`.btn-primary`) — é o ponto positivo (uma mudança, efeito generalizado) e o ponto de risco (regressão visual em algum canto não conferido). Mitigação: depois da Fase 1, checar visualmente pelo menos uma tela de cada área principal (projeto, banco, servidor, configurações, login) antes de seguir pra Fase 2 — não só confiar que "deve ter funcionado" porque a classe mudou.
