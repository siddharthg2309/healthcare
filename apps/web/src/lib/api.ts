export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    const message = typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error.replaceAll("_", " ")
        : "The request could not be completed.";
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body.error === "string" ? body.error : "request_failed";
    this.details = body;
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export function postJson<T>(path: string, data: unknown): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify(data) });
}

export function putJson<T>(path: string, data: unknown): Promise<T> {
  return requestJson<T>(path, { method: "PUT", body: JSON.stringify(data) });
}
