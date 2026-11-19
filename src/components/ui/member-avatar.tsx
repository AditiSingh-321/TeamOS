import { cn } from "@/lib/utils";
import type { Member } from "@/types/workspace";

const tones = {
  violet: "bg-violet-soft text-violet-ink",
  green: "bg-green-soft text-green-ink",
  rose: "bg-rose-soft text-rose-ink",
  blue: "bg-blue-soft text-blue-ink",
  amber: "bg-amber-soft text-amber-ink",
};

export function MemberAvatar({ member, className }: { member: Pick<Member, "name" | "initials" | "tone">; className?: string }) {
  return (
    <span role="img" aria-label={member.name} title={member.name} className={cn("inline-grid size-8 shrink-0 place-items-center rounded-full border-2 border-card text-[11px] font-medium shadow-xs", tones[member.tone], className)}>
      {member.initials}
    </span>
  );
}
