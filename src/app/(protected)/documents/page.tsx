import { KnowledgePage } from "@/components/knowledge/project-page";
export const metadata = { title: "Documents" };
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return <KnowledgePage mode="documents" selected={(await searchParams).project} />;
}
