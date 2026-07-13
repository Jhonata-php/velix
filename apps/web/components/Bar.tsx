export function Bar({ percent }: { percent: number }) {
  const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}
