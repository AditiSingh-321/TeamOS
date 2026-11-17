import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createAuthClient } from "@/lib/supabase/server";
import type { AuthProfile } from "@/types/auth";

export const getAuthProfile = cache(async (): Promise<AuthProfile | null> => {
  const supabase = await createAuthClient();
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const fullName: unknown = user.user_metadata.full_name;
  const email = user.email ?? "";
  const name = (typeof fullName === "string" && fullName.trim().slice(0, 100)) || email.split("@")[0] || "TeamOS member";
  const initials = name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();

  return { name, email, initials };
});

export async function requireAuth() {
  const profile = await getAuthProfile();
  if (!profile) redirect("/login");
  return profile;
}
