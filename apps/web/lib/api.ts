// Sempre relativo: server.js repassa /api/* pro backend (ver ponytail-bugfix
// lá), então o browser nunca faz requisição cross-origin.
const API_URL = '/api';
const REQUEST_TIMEOUT_MS = 20_000;

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

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('O servidor demorou para responder.');
    }
    throw new ApiError('Não foi possível conectar ao servidor.');
  } finally {
    clearTimeout(timeout);
  }

  // /auth/login com 401 é credencial errada, não sessão expirada — não faz
  // sentido limpar um token que ainda nem existe, nem redirecionar pra onde
  // o usuário já está.
  const isLoginRequest = path === '/auth/login';

  if (res.status === 401 && !isLoginRequest) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: undefined as string | undefined }));
    if (res.status === 401) {
      throw new ApiError(body.message ?? 'E-mail ou senha inválidos.', 401);
    }
    if (res.status === 403) {
      throw new ApiError(body.message ?? 'Você não tem permissão para executar esta ação.', 403);
    }
    if (res.status >= 500) {
      throw new ApiError('Erro interno no servidor. Tente novamente em instantes.', res.status);
    }
    throw new ApiError(body.message ?? `Erro ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  // ponytail: NestJS manda corpo vazio (não a string "null") quando o handler
  // retorna null/undefined — res.json() quebra em corpo vazio independente do
  // status, então lê como texto primeiro em vez de confiar só no 204.
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}
