import { cn } from "@/lib/utils";
import type { Member } from "@/types/workspace";

const tones = {
  violet: "bg-violet-100 text-violet-800",
  green: "bg-emerald-100 text-emerald-800",
  rose: "bg-rose-100 text-rose-800",
  blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-800",
};

export function MemberAvatar({ member, className }: { member: Member; className?: string }) {
  return (
    <span role="img" aria-label={member.name} title={member.name} className={cn("inline-grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold", tones[member.tone], className)}>
      {member.initials}
    </span>
  );
}
