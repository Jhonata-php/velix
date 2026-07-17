import type { ReactNode } from 'react';

/** Coluna lateral operacional — só aparece em telas largas (>=1280px) e some em
 * telas menores. Composição livre via OperationalPanelSection, não um formato fixo. */
export function OperationalPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="hidden xl:block xl:w-[268px] xl:shrink-0">
      <div className="sticky top-[88px] flex flex-col gap-3">{children}</div>
    </aside>
  );
}

export function OperationalPanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <p className="section-label mb-2.5">{title}</p>
      {children}
    </div>
  );
}
