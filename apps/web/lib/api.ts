// Sempre relativo: o rewrite em next.config.js encaminha /api/* pro backend,
// então o browser nunca faz requisição cross-origin.
const API_URL = '/api';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('velix_token');
}

export function setToken(token: string) {
  localStorage.setItem('velix_token', token);
}

export function clearToken() {
  localStorage.removeItem('velix_token');
  localStorage.removeItem('velix_user');
}

export interface StoredUser {
  name: string;
  email: string;
  role: string;
}

export function setUser(user: StoredUser) {
  localStorage.setItem('velix_user', JSON.stringify(user));
}

export function getUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('velix_user');
  return raw ? JSON.parse(raw) : null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Erro ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
