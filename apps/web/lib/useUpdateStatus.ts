import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAutoRefresh } from './useAutoRefresh';

export interface ReleaseInfo {
  version: string;
  tagName: string;
  channel: string;
  publishedAt: string | null;
  url: string;
  /** HTML já sanitizado pelo backend — seguro pra dangerouslySetInnerHTML direto. */
  changelogHtml: string;
  prerelease: boolean;
}

export interface UpdateCheckSummary {
  installedVersion: string;
  channel: string;
  updateAvailable: boolean;
  release: ReleaseInfo | null;
  error: string | null;
  checkedAt: string;
}

// Acompanha o cache de 10min do backend (GitHubReleaseService) — consultar
// mais rápido que isso só bateria sempre no cache, sem trazer dado mais novo.
const POLL_MS = 10 * 60 * 1000;

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateCheckSummary | null>(null);

  function load() {
    apiFetch<UpdateCheckSummary>('/updates/latest')
      .then(setStatus)
      .catch(() => {});
  }

  useEffect(load, []);
  useAutoRefresh(load, POLL_MS);

  return status;
}
