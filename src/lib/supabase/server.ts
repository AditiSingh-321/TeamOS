import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions, supabaseConfig } from "./config";

export async function createAuthClient(writable = false) {
  const cookieStore = await cookies();
  const config = supabaseConfig();
  if (!config) return null;

  return createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        // Proxy handles refresh writes when rendering Server Components.
        if (writable) {
          for (const { name, value, options } of values) cookieStore.set(name, value, options);
        }
      },
    },
  });
}

// Credential checks must never replace a browser's active account/session.
export function createPasswordVerifier() {
  const config = supabaseConfig();
  return config ? createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) : null;
}
