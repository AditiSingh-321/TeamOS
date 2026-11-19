"use client";
import { useRef, useState } from "react";
import { codeDigits, codeFocus } from "@/lib/auth/password-validation";
export function ResetCodeInput() {
  const [digits, setDigits] = useState(Array<string>(6).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  function insert(index: number, raw: string) {
    const value = codeDigits(raw);
    const start = value.length === 6 ? 0 : index;
    setDigits(previous => {
      const next = [...previous];
      if (!value) next[index] = "";
      else for (let offset = 0; offset < value.length && start + offset < 6; offset++) next[start + offset] = value[offset];
      return next;
    });
    if (value) inputs.current[Math.min(5, start + value.length)]?.focus();
  }
  return <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Verification code</legend><input type="hidden" name="token" value={digits.join("")}/><div className="flex gap-2">{digits.map((digit,index) => <input key={index} ref={node => { inputs.current[index] = node; }} aria-label={`Code digit ${index + 1} of 6`} type="text" inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} pattern="[0-9]*" maxLength={6} required value={digit} onFocus={event => event.currentTarget.select()} onChange={event => insert(index, event.target.value)} onPaste={event => { event.preventDefault(); insert(index,event.clipboardData.getData("text")); }} onKeyDown={event => {
    if (["ArrowLeft","ArrowRight"].includes(event.key)) { event.preventDefault(); inputs.current[codeFocus(index,event.key)]?.focus(); }
    if (event.key === "Backspace" && !digit) { event.preventDefault(); const previous = codeFocus(index,event.key); insert(previous, ""); inputs.current[previous]?.focus(); }
  }} className="h-12 min-w-0 flex-1 rounded-lg border bg-card text-center text-xl font-semibold tabular-nums shadow-xs"/>)}</div><p className="text-xs text-muted-foreground">You can paste the complete six-digit code.</p></fieldset>;
}
