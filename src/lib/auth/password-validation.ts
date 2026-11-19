import { z } from "zod";

export const recoveryEmailSchema = z.string().trim().max(254).email("Enter a valid email address.");
export const resetCodeSchema = z.string().regex(/^\d{6}$/, "Enter all six digits from your recovery email.");
export const newPasswordSchema = z.object({
  password: z.string().min(8, "Use at least 8 characters. A longer passphrase is even better.").max(256, "Use at most 256 characters."),
  confirm: z.string(),
}).refine(value => value.password === value.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export function passwordStrength(password: string) {
  if (password.length < 8) return { score: 0, label: "Use at least 8 characters" };
  if (password.length < 12) return { score: 1, label: "Fair · try a longer password" };
  if (password.length < 16) return { score: 2, label: "Good · longer is stronger" };
  return { score: 3, label: "Long passphrase · avoid reuse and common phrases" };
}

export function codeDigits(value: string) { return value.replace(/[^0-9]/g, "").slice(0, 6); }
export function codeFocus(index: number, key: string) {
  return Math.max(0, Math.min(5, index + (key === "ArrowLeft" || key === "Backspace" ? -1 : key === "ArrowRight" ? 1 : 0)));
}
