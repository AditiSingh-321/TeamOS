"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { passwordStrength } from "@/lib/auth/password-validation";

export function PasswordField({ name, label, current = false, onValue }: { name: string; label: string; current?: boolean; onValue?: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  return <div className="space-y-1.5"><label htmlFor={name} className="block text-sm font-medium">{label}</label><div className="relative"><input id={name} name={name} type={visible ? "text" : "password"} autoComplete={current ? "current-password" : "new-password"} minLength={current ? undefined : 8} maxLength={256} required value={value} onChange={e => { setValue(e.target.value); onValue?.(e.target.value); }} className="ui-field w-full pr-12"/><button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground hover:text-primary">{visible ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}</button></div></div>;
}
export function PasswordStrengthIndicator({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return <div className="space-y-2" aria-live="polite"><div className="flex gap-1" aria-hidden="true">{[1,2,3].map(step => <span key={step} className={`h-1 flex-1 rounded-full ${strength.score >= step ? strength.score > 1 ? "bg-green-ink" : "bg-amber-ink" : "bg-border"}`}/>)}</div><p className="text-xs leading-5 text-muted-foreground">{password ? strength.label : "Use at least 8 characters. Long, unique passphrases are welcome."}</p></div>;
}
