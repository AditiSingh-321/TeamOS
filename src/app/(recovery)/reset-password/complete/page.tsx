import { AuthSuccessState } from "@/components/auth/password-forms";
import { Card } from "@/components/ui/card";
export const metadata = { title: "Password updated" };
export default function Page() { return <Card className="p-6 shadow-[var(--shadow-float)] sm:p-8"><AuthSuccessState/></Card>; }
