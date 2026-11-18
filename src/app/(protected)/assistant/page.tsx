import { KnowledgePage } from "@/components/knowledge/project-page";
export const metadata = { title: "AI Assistant" };
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return <KnowledgePage mode="assistant" selected={(await searchParams).project} />;
}
