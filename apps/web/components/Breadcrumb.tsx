import Link from 'next/link';
import { Fragment } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span>/</span>}
          {item.href ? (
            <Link href={item.href} className="truncate hover:text-indigo-600 hover:underline dark:hover:text-indigo-400">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-slate-500 dark:text-slate-300">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
