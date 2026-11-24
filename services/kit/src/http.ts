/** Small HTTP client with timeouts and readable errors. */

export interface HttpOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, ...init } = opts;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300) || res.statusText}`);
  }
  if (!text) throw new Error(`Empty response from ${url}.`);
  return JSON.parse(text) as T;
}

export function postJson<T>(url: string, body: unknown, opts: HttpOptions = {}): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ...opts,
  });
}

/** Exponential backoff for service-to-service calls; never used for chain writes (the SDK does those). */
export async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 300;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /fetch failed|timeout|timed out|ECONNRESET|ECONNREFUSED|429|rate limit|50[234]/i.test(msg);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${last instanceof Error ? last.message : String(last)}`);
}
