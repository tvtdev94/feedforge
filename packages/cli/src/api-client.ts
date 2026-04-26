import { UserError } from './errors.js';
import { env } from './env.js';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.apiKey) {
    throw new UserError(
      'FEEDFORGE_API_KEY not set. Export it before running the CLI.',
    );
  }
  const url = `${env.apiUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'X-API-Key': env.apiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UserError(
      `Cannot reach API at ${env.apiUrl} (${message}). Is 'pnpm api:dev' running?`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new UserError(`API ${res.status} ${method} ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
};
