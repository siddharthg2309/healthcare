import { authenticatedFetch } from "@/lib/auth/client";

export class MobileApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.error === "string" ? body.error : "request_failed";
    super(typeof body.message === "string" ? body.message : code.replaceAll("_", " "));
    this.name = "MobileApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await authenticatedFetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new MobileApiError(response.status, body);
  return body as T;
}

export function apiPost<T>(path: string, data: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(data) });
}

export function apiPut<T>(path: string, data: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body: JSON.stringify(data) });
}
