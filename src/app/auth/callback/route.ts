import { googleCallbackUrl } from "@/lib/supabase/config";
import { createAuthClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const flowId = searchParams.get("sb_flow_id");
  let location = "/login?error=oauth";

  if (code && googleCallbackUrl()) {
    const supabase = await createAuthClient(true);
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (!error) location = "/";
    }
  }

  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
