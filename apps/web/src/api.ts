const base = import.meta.env.VITE_API_BASE ?? "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function eventStream(path: string) {
  return new EventSource(`${base}${path}`);
}
