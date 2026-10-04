// Auth helpers for the authCore JWT flow (admin-authcore T2).
//
// The JWT lives in a non-httpOnly `token` cookie (path=/, 7 days, SameSite=Lax,
// Secure on HTTPS) so the SPA can attach `Authorization: Bearer` on every
// admin request — same tradeoff the ecosystem spoke documents.
//
// Testability note: jsdom 30 marks `window.location` non-configurable and
// `location.assign` non-writable, so tests cannot spy on a raw
// `window.location.href = ...` assignment. The single navigation call lives in
// `redirectToAuth`, which tests can replace.

export function getToken(): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith("token="));
  return match ? decodeURIComponent(match.slice("token=".length)) : null;
}

export function setToken(token: string): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `token=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax${secure}`;
}

export function clearToken(): void {
  document.cookie = "token=; path=/; max-age=0; SameSite=Lax";
}

export function loginUrl(): string {
  const base =
    import.meta.env.VITE_AUTHCORE_URL || "https://api-authcore.rincom.es";
  const redirect = `${location.origin}/auth/callback`;
  return `${base}/api/v1/auth/google?redirect_to=${encodeURIComponent(redirect)}`;
}

// Hand the browser over to the authCore Google OAuth flow. authCore redirects
// back to /auth/callback?token=JWT after a successful login.
export function redirectToAuth(): void {
  window.location.href = loginUrl();
}
