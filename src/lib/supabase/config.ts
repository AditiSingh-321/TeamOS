import "server-only";

function secureOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol === "https:" || localHttp) && !url.username && !url.password) return url.origin;
  } catch {
    return null;
  }
  return null;
}

export function supabaseConfig() {
  const url = secureOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key?.startsWith("sb_publishable_") || key === "sb_publishable_replace_me") return null;
  return { url, key };
}

export function googleCallbackUrl() {
  const origin = secureOrigin(process.env.TEAMOS_SITE_URL);
  return origin && process.env.TEAMOS_GOOGLE_AUTH_ENABLED === "true" && supabaseConfig()
    ? new URL("/auth/callback", origin).toString()
    : null;
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
