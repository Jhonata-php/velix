import { useEffect, useRef } from 'react';

/** Chama `callback` a cada `intervalMs` — usado pro auto-refresh de status/métricas. */
export function useAutoRefresh(callback: () => void, intervalMs = 10_000) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
