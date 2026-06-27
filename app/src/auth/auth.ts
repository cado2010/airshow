// Client-side JWT auth. The token is kept in memory only (not persisted), so a
// fresh page load or Electron launch always returns to the login screen — as
// required. All /api calls attach `Authorization: Bearer <token>`; the SSE
// stream (EventSource, which can't set headers) appends ?token=<token>.

let token: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to auth-state changes (login/logout). Returns an unsubscribe fn. */
export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isAuthed(): boolean {
  return token !== null;
}

export function getToken(): string | null {
  return token;
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Append the token as a query param (for EventSource URLs). */
export function withToken(url: string): string {
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

export function logout(): void {
  if (token === null) return;
  token = null;
  notify();
}

/** POST credentials to /api/login; stores the JWT on success. Throws on failure. */
export async function login(email: string, password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let msg = "Login failed.";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("Login failed: no token returned.");
  token = data.token;
  notify();
}

/**
 * fetch() wrapper that attaches the bearer token and auto-logs-out on 401, so an
 * expired/invalid token bounces the user back to the login screen.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders() },
  });
  if (res.status === 401) logout();
  return res;
}
