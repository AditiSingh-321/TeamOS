import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, supabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  if (!config) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies, headers) {
        for (const { name, value } of cookies) request.cookies.set(name, value);

        const previousResponse = response;
        response = NextResponse.next({ request });
        for (const cookie of previousResponse.cookies.getAll()) response.cookies.set(cookie);
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/", "/projects/:path*", "/workspaces/:path*", "/my-tasks/:path*", "/dependencies/:path*", "/approvals/:path*", "/notifications/:path*", "/api/notifications/:path*", "/api/collaboration/:path*", "/meetings/:path*", "/risks/:path*", "/documents/:path*", "/assistant/:path*", "/api/projects/:path*", "/login", "/signup"],
};
