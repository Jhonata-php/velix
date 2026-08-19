# Redesign visual (Fase 1 — Fundação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever as classes CSS compartilhadas e os componentes-base do painel (`apps/web`) pra um visual plano, denso e técnico (estilo EasyPanel/Coolify) — sem sombra artificial, sem gradiente, menos arredondado, com uma primitiva nova pra status em linha de lista.

**Architecture:** Edição pontual de `app/globals.css` (classes `@layer components`) e de dois componentes React já usados em quase toda tela (`Modal.tsx`, `StatusBadge.tsx`). Como praticamente todo o painel já usa essas classes/componentes em vez de estilo solto, essa mudança cascata pra maior parte das telas sem precisar tocar cada arquivo — a varredura do que sobrar é a Fase 2 (plano separado, escrito depois que o efeito desta fase estiver visível).

**Tech Stack:** Next.js (App Router) + Tailwind CSS, TypeScript. Sem framework de teste no frontend (`apps/web` não tem test runner configurado) — verificação é `tsc --noEmit` + inspeção visual.

## Global Constraints

- Não mudar a paleta de cor (`slate`/`indigo` em `apps/web/tailwind.config.ts` permanecem exatamente como estão).
- Não trocar biblioteca de ícones — `components/icons.tsx` continua o mesmo conjunto.
- Dark e light mode continuam os dois suportados, sem mudar o mecanismo de alternância (`next-themes`, `attribute="class"`).
- Sem sombra artificial (`box-shadow` decorativo) em card, botão primário ou pílula de aba — só as sombras funcionais mínimas que já existem em outro lugar (ex.: foco de input) continuam.
- Cada task termina com `npx tsc --noEmit` limpo em `apps/web` antes de seguir pra próxima.

---

## Referência: spec completa

`docs/superpowers/specs/2026-08-18-visual-redesign-design.md` — este plano implementa as seções 2.1 (cards), 2.2 (botões), 2.5 (primitiva de status em linha) e 2.7 (modais) dela. As seções 2.3 (densidade), 2.4 (tipografia técnica) e 2.6 (ícones em lista) são aplicadas tela a tela na Fase 2, não aqui.

---

### Task 1: Cards e superfícies sem sombra

**Files:**
- Modify: `apps/web/app/globals.css:25-35`

**Interfaces:**
- Consumes: nada (é a base).
- Produces: classes `.card`, `.card-hover`, `.surface-elevated` — consumidas por praticamente todo componente do painel (`Modal`, `EmptyState`, `ErrorState`, e dezenas de telas). Nenhuma mudança de assinatura, só de aparência.

- [ ] **Step 1: Editar `.card`, `.card-hover`, `.surface-elevated` em `globals.css`**

Encontre este bloco (linhas 25-35 hoje):

```css
  .card {
    @apply rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.18)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.03)];
  }
  .card-hover {
    @apply transition hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.24)] dark:hover:border-slate-600;
  }
  /* Superfície de 3º nível — mais clara que .card no escuro, usada só pra blocos
     que precisam se destacar do resto da página (cabeçalho de entidade, header de módulo). */
  .surface-elevated {
    @apply rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-800/50 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.04)];
  }
```

Substitua por:

```css
  /* Plano, sem sombra decorativa — a borda sozinha define o limite do card.
     Ver docs/superpowers/specs/2026-08-18-visual-redesign-design.md §2.1. */
  .card {
    @apply rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900;
  }
  .card-hover {
    @apply transition-colors hover:border-slate-300 dark:hover:border-slate-600;
  }
  /* Superfície de 3º nível — mais clara que .card no escuro, usada só pra blocos
     que precisam se destacar do resto da página (cabeçalho de entidade, header de módulo). */
  .surface-elevated {
    @apply rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50;
  }
```

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erro (CSS não afeta TS, mas confirma que nada mais quebrou no repo antes de seguir).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "Achata .card/.card-hover/.surface-elevated — sem sombra decorativa, borda mais reta"
```

---

### Task 2: Botão primário e aba ativa sem gradiente/glow

**Files:**
- Modify: `apps/web/app/globals.css:13-14` (`.btn-primary`)
- Modify: `apps/web/app/globals.css:60-62` (`.tab-pill-active`)

**Interfaces:**
- Consumes: nada.
- Produces: classes `.btn-primary`, `.tab-pill-active` — mesma assinatura, aparência nova.

- [ ] **Step 1: Editar `.btn-primary`**

Encontre:

```css
  .btn-primary {
    @apply rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_-6px_rgba(79,70,229,0.45)] transition hover:from-indigo-400 hover:to-indigo-500 hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_20px_-6px_rgba(79,70,229,0.55)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 dark:from-indigo-500 dark:to-indigo-600 dark:hover:from-indigo-400 dark:hover:to-indigo-500;
  }
```

Substitua por:

```css
  /* Sólido, sem gradiente nem glow — ver spec §2.2. */
  .btn-primary {
    @apply rounded-lg bg-indigo-600 font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100;
  }
```

- [ ] **Step 2: Editar `.tab-pill-active`**

Encontre:

```css
  .tab-pill-active {
    @apply bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white;
  }
```

Substitua por:

```css
  .tab-pill-active {
    @apply bg-white text-slate-900 dark:bg-slate-700 dark:text-white;
  }
```

- [ ] **Step 3: Verificar visualmente no /login (única tela pública que usa `.btn-primary` sem precisar de sessão)**

1. Suba o dev server: `cd apps/web && npm run dev` (ou o preview configurado no projeto).
2. Abra `/login` no navegador.
3. Confirme: botão "Entrar" é roxo sólido (`#6d5dfc`/indigo-600), sem gradiente visível, sem brilho colorido ao redor — só um leve escurecer/clarear no hover.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "Achata .btn-primary e .tab-pill-active — sem gradiente, sem glow, sem shadow-sm"
```

---

### Task 3: Nova primitiva — status em linha de lista (borda lateral + texto)

**Files:**
- Modify: `apps/web/components/StatusBadge.tsx`

**Interfaces:**
- Consumes: `StatusTone` (já exportado neste mesmo arquivo).
- Produces:
  - `rowStatusBorderClass(tone: StatusTone): string` — devolve a classe Tailwind de borda (ex.: `"border-green-500"`).
  - `RowStatusLabel({ tone: StatusTone, children: ReactNode })` — componente de texto colorido, sem fundo/pílula.
  - Ambos serão consumidos pela Fase 2 (plano futuro) em toda lista/tabela que hoje usa `StatusBadge` numa linha (projetos, serviços, domínios, execuções de backup). Não há consumidor nesta Fase 1 — é só a definição da primitiva.

- [ ] **Step 1: Adicionar os dois novos exports em `StatusBadge.tsx`**

Depois do bloco `TONE_DOT` (linhas 13-19 hoje) e antes de `export function StatusDot`, adicione:

```tsx
const TONE_BORDER: Record<StatusTone, string> = {
  success: 'border-green-500',
  warning: 'border-amber-400',
  danger: 'border-red-500',
  info: 'border-sky-400',
  neutral: 'border-slate-400',
};

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-green-600 dark:text-green-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  info: 'text-sky-600 dark:text-sky-400',
  neutral: 'text-slate-500 dark:text-slate-400',
};

/** Classe de borda lateral pra linha de lista/tabela densa — usar junto de
 * `pl-3` no container da linha, ex.: `border-l-[3px] ${rowStatusBorderClass(tone)} pl-3`.
 * Substitui o badge-pílula em linha de lista (ver spec do redesign visual,
 * docs/superpowers/specs/2026-08-18-visual-redesign-design.md §2.5) — o badge
 * (`StatusBadge` abaixo) continua reservado pra cabeçalho/resumo. */
export function rowStatusBorderClass(tone: StatusTone): string {
  return TONE_BORDER[tone];
}

/** Rótulo de texto colorido pra acompanhar `rowStatusBorderClass` — sem fundo,
 * sem pílula, só texto curto na cor do tom. */
export function RowStatusLabel({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`text-xs font-medium uppercase tracking-wide ${TONE_TEXT[tone]}`}>{children}</span>;
}
```

O arquivo já importa `type { ReactNode }` no topo — não precisa de import novo.

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/StatusBadge.tsx
git commit -m "Adiciona rowStatusBorderClass/RowStatusLabel — primitiva de status em linha pra Fase 2"
```

---

### Task 4: Modal com cabeçalho mais compacto

**Files:**
- Modify: `apps/web/components/Modal.tsx:36-38`

**Interfaces:**
- Consumes: classe `.card` (já editada na Task 1 — o modal herda o visual plano automaticamente, essa task só ajusta o espaçamento interno do cabeçalho).
- Produces: nenhuma mudança de props/assinatura do componente `Modal`/`ConfirmModal`.

- [ ] **Step 1: Reduzir padding do modal e margem do cabeçalho**

Encontre (linhas 36-38 hoje):

```tsx
      <div className={`modal-pop card w-full ${maxWidth} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
```

Substitua por:

```tsx
      <div className={`modal-pop card w-full ${maxWidth} p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
```

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/Modal.tsx
git commit -m "Modal: cabeçalho mais compacto (p-6→p-5, mb-4→mb-3)"
```

---

### Task 5: Bump de versão, push e release

**Files:**
- Modify: `apps/api/VERSION`

**Interfaces:**
- Consumes: nada.
- Produces: nova tag/release Git — é o que o "Centro de Atualizações" do próprio Velix usa pra detectar a versão nova (ver `apps/api/src/updates/`).

- [ ] **Step 1: Incrementar `apps/api/VERSION`** (patch — é um redesign visual, não uma feature nova nem um fix isolado; mesmo padrão já usado nesta sessão pra cada lote de mudanças).

- [ ] **Step 2: Push + tag + release**

```bash
git push origin main
git tag vX.Y.Z   # X.Y.Z = valor gravado em apps/api/VERSION no Step 1
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes "Fase 1 do redesign visual: cards/botões/abas sem sombra ou gradiente, modal mais compacto, nova primitiva de status em linha (aplicada tela a tela na Fase 2)."
```

- [ ] **Step 3: Pedir confirmação visual ao usuário**

Depois do deploy (usuário clica "Atualizar" no painel dele, mesmo fluxo já estabelecido nesta sessão), pedir pra ele olhar pelo menos: um card em qualquer lista, o botão primário em qualquer formulário, e um modal — confirmar que bate com a direção aprovada antes de planejar a Fase 2.
