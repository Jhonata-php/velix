import { useId } from 'react';

interface Props {
  data: number[];
  className?: string;
  stroke?: string;
}

// Catmull-Rom -> cubic bezier: turns the straight polyline into a smooth curve through every point.
function smoothPath(points: { x: number; y: number }[]) {
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export function Sparkline({ data, className = 'h-8 w-full', stroke = 'currentColor' }: Props) {
  const gradientId = useId();

  if (data.length < 2) {
    return <div className={className} />;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || Math.max(max, 1) * 0.1 || 1;
  const coords = data.map((v, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: 6 + (100 - ((v - min) / range) * 100) * 0.88,
  }));
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L 100,100 L 0,100 Z`;
  const last = coords[coords.length - 1];

  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900"
        style={{ left: `${last.x}%`, top: `${last.y}%`, backgroundColor: stroke, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
}
