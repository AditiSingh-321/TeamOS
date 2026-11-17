import { Layers3 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthProfile } from "@/lib/auth/session";

export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await getAuthProfile()) redirect("/");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/login" className="mx-auto mb-7 flex w-fit items-center gap-3 rounded-md">
          <span className="grid size-9 place-items-center rounded-[10px] bg-violet-600 text-white">
            <Layers3 size={20} aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold tracking-tight">TeamOS</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
