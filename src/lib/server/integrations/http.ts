import { HttpError } from "../util";

const MAX_RESPONSE = 5 * 1024 * 1024;

export function allowInsecure() {
  return process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS === "1";
}

/** Validate a user-supplied base URL: https only (http only for tests), no credentials, no fragments. */
export function safeBaseUrl(raw: string, field: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, `${field}: URL inválida`);
  }
  if (u.protocol !== "https:" && !(allowInsecure() && u.protocol === "http:")) throw new HttpError(400, `${field}: debe usar https`);
  if (u.username || u.password) throw new HttpError(400, `${field}: no incluyas credenciales en la URL`);
  u.hash = "";
  u.search = "";
  return u;
}

/** The reason the provider gave for a rejected request (GitHub and Bitbucket error shapes), short and single-line. */
export function upstreamDetail(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: unknown; errors?: unknown; error?: { message?: unknown; detail?: unknown; fields?: Record<string, unknown> } };
    const parts: string[] = [];
    if (typeof j.error?.message === "string") parts.push(j.error.message);
    if (typeof j.error?.detail === "string") parts.push(j.error.detail);
    if (j.error?.fields) for (const [k, v] of Object.entries(j.error.fields)) parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    if (typeof j.message === "string") parts.push(j.message);
    if (Array.isArray(j.errors)) for (const e of j.errors) parts.push(typeof e === "string" ? e : typeof (e as { message?: string }).message === "string" ? (e as { message: string }).message : "");
    return parts.filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return "";
  }
}

export class IntegrationError extends HttpError {
  upstreamStatus: number;
  constructor(
    public provider: string,
    status: number,
    message: string,
  ) {
    // Upstream failures are surfaced as 502 so they are never confused with our own 4xx.
    super(502, `${provider}: ${message}`);
    this.upstreamStatus = status;
  }
}

/**
 * Outbound HTTP for integrations: fixed origin, timeout, no cross-host
 * redirects, capped response size, JSON in/out. Never logs headers.
 */
export async function request<T>(
  provider: string,
  base: URL,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  let url = new URL(path, base);
  if (url.origin !== base.origin) throw new IntegrationError(provider, 0, "destino no permitido");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 10_000);
  let res: Response;
  try {
    // Follow at most 3 redirects, and only within the same origin (credentials never leave it).
    for (let hops = 0; ; hops++) {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          "user-agent": "agentic-console",
          ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.form ? new URLSearchParams(init.form).toString() : init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: "manual",
        signal: ctrl.signal,
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      const next = loc ? new URL(loc, url) : null;
      if (!next || next.origin !== base.origin || hops >= 3 || (init.method && init.method !== "GET"))
        throw new IntegrationError(provider, res.status, "redirección no permitida");
      url = next;
    }
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError(provider, 0, (e as Error).name === "AbortError" ? "tiempo de espera agotado" : "no se pudo conectar");
  } finally {
    clearTimeout(timer);
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_RESPONSE) throw new IntegrationError(provider, res.status, "respuesta demasiado grande");
  const text = await res.text();
  if (text.length > MAX_RESPONSE) throw new IntegrationError(provider, res.status, "respuesta demasiado grande");
  if (!res.ok) {
    const hint = res.status === 401 ? "credenciales no válidas" : res.status === 403 ? "sin permisos" : res.status === 404 ? "no encontrado" : `error ${res.status}`;
    // For rejected requests (400/409/422) the provider's own reason is what the user needs to fix the problem.
    const detail = [400, 409, 422].includes(res.status) ? upstreamDetail(text) : "";
    throw new IntegrationError(provider, res.status, detail ? `${hint}: ${detail}` : hint);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
