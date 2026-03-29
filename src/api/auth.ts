/**
 * OpenF1 authentication helpers.
 *
 * The app uses a single long-lived access token stored in VITE_OPENF1_API_KEY.
 * This token is obtained from the OpenF1 OAuth2 endpoint:
 *   POST https://api.openf1.org/token  { username, password }
 * and is valid for 3 600 s (1 hour).  Renew it and update .env as needed.
 *
 * Security note: VITE_ env vars are bundled into the client build.  This is
 * acceptable for personal / self-hosted use.  For a public deployment, proxy
 * authenticated requests through your own backend.
 *
 * Docs: https://openf1.org/#authentication
 */

const API_KEY = import.meta.env.VITE_OPENF1_API_KEY as string | undefined;

// ─── Exports ─────────────────────────────────────────────────────────────────

/** True when an API key is present in the environment. */
export const hasAuthKey: boolean = Boolean(
  API_KEY && API_KEY.trim().length > 0,
);

/**
 * Returns an `Authorization: Bearer` header record when a key is configured.
 * Returns an empty object on the free (unauthenticated) tier.
 *
 * Usage:
 *   const res = await fetch(url, { headers: getAuthHeaders() });
 */
export function getAuthHeaders(): Record<string, string> {
  if (!hasAuthKey) return {};
  return { Authorization: `Bearer ${API_KEY!}` };
}

/**
 * Returns MQTT / WebSocket credentials when a key is configured.
 * The access token is used as the password; the username is a static string
 * (OpenF1 accepts any non-empty username for token-based auth).
 *
 * Returns null on the free (unauthenticated) tier — caller should fall back
 * to REST polling instead.
 */
export function getMqttCredentials(): {
  username: string;
  password: string;
} | null {
  if (!hasAuthKey) return null;
  return {
    username: "f1-live-tracker",
    password: API_KEY!,
  };
}
