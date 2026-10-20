import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

const calendarScope = "https://www.googleapis.com/auth/calendar.app.created";

export class GoogleCalendarError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GoogleCalendarError";
    this.code = code;
  }
}

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
};

export type GoogleCalendar = { id: string; summary: string };

export function googleCalendarConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY);
}

export function createGoogleAuthorizationUrl(state: string): string {
  if (!googleCalendarConfigured() || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
    throw new GoogleCalendarError("google_calendar_not_configured");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: calendarScope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function makeOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  return tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: requiredConfig(env.GOOGLE_REDIRECT_URI),
    client_id: requiredConfig(env.GOOGLE_CLIENT_ID),
    client_secret: requiredConfig(env.GOOGLE_CLIENT_SECRET),
  });
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const token = await tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    client_id: requiredConfig(env.GOOGLE_CLIENT_ID),
    client_secret: requiredConfig(env.GOOGLE_CLIENT_SECRET),
  });
  return token.accessToken;
}

export async function revokeGoogleRefreshToken(refreshToken: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return false;
  }
  return response.ok || response.status === 400;
}

export async function createGoalHealthCalendar(accessToken: string, timezone: string): Promise<GoogleCalendar> {
  const result = await googleCalendarRequest<Partial<GoogleCalendar>>(accessToken, "/calendars", "POST", {
    summary: "Goal Health Workouts",
    timeZone: timezone,
  });
  if (!result.id || !result.summary) throw new GoogleCalendarError("google_calendar_create_failed");
  return { id: result.id, summary: result.summary };
}

export async function googleCalendarRequest<T>(
  accessToken: string,
  resource: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const url = new URL(`/calendar/v3${resource}`, "https://www.googleapis.com");
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleCalendarError("google_calendar_unavailable");
  }
  if (response.status === 404 || response.status === 410) throw new GoogleCalendarError("google_calendar_resource_missing");
  if (!response.ok) throw new GoogleCalendarError("google_calendar_request_failed");
  if (response.status === 204) return {} as T;
  return await response.json() as T;
}

export function encryptGoogleRefreshToken(refreshToken: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGoogleRefreshToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new GoogleCalendarError("google_calendar_token_unreadable");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new GoogleCalendarError("google_calendar_token_unreadable");
  }
}

export function stableGoogleEventId(value: string): string {
  return `gh${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

async function tokenRequest(formValues: Record<string, string>): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams(formValues);
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleCalendarError("google_oauth_unavailable");
  }
  const result = await response.json().catch(() => null) as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  if (!response.ok || typeof result?.access_token !== "string") {
    throw new GoogleCalendarError("google_oauth_exchange_failed");
  }
  return {
    accessToken: result.access_token,
    refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : null,
  };
}

function encryptionKey(): Buffer {
  const value = env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new GoogleCalendarError("google_calendar_not_configured");
  }
  return Buffer.from(value, "hex");
}

function requiredConfig(value: string | undefined): string {
  if (!value) throw new GoogleCalendarError("google_calendar_not_configured");
  return value;
}
