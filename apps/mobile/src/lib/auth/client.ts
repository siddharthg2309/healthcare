import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("Set EXPO_PUBLIC_API_BASE_URL in apps/mobile/.env before using the API.");
}

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  plugins: [
    expoClient({
      scheme: "healthcare",
      storagePrefix: "healthcare",
      storage: SecureStore,
    }),
  ],
});

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = await authClient.getCookie();
  if (cookie) headers.set("Cookie", cookie);

  return fetch(new URL(path, apiBaseUrl), {
    ...init,
    headers,
    credentials: "omit",
  });
}
