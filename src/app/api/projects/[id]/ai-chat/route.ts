import { answerPrompt, rewritePrompt } from "@/lib/knowledge/prompts";
import { isOverdueTaskQuestion } from "@/lib/intelligence/registry";
import { questionSchema } from "@/lib/knowledge/validation";
import { z } from "zod";
import { assertSameOrigin, boundedBody, databaseFailure, httpError, projectContext } from "@/lib/knowledge/http";
import { answerQuestion } from "@/lib/knowledge/rag";
import { answerSchema, embedTexts, structuredResponse } from "@/lib/knowledge/provider";
import { type Source } from "@/lib/knowledge/validation";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { supabase, project } = await projectContext((await context.params).id);
    const value: unknown = JSON.parse((await boundedBody(request, 50000)).toString("utf8"));
    const input = questionSchema.parse(value);
    if (isOverdueTaskQuestion(input.question)) {
      const { data, count, error } = await supabase.from("tasks").select("id,title,due_date",{count:"exact"}).eq("project_id",project.id).neq("status","Done").lt("due_date",new Date().toISOString().slice(0,10)).order("due_date").limit(50);
      databaseFailure(error);
      return Response.json({ answer: data?.length ? `Live project task data: ${count} overdue task(s).${(count??0)>50?" Showing the first 50.":""}\n\n${data.map(task=>`${task.title} — due ${task.due_date}`).join("\n")}` : "There are no incomplete overdue tasks in this project.", citations: [], abstained: false, taskReferences: (data??[]).map(task=>({id:task.id,title:task.title})) },{headers:{"Cache-Control":"no-store"}});
    }
    const result = await answerQuestion(input, {
      authorize: async () => { /* projectContext authenticated and checked live membership. */ },
      reserve: async () => { const { error } = await supabase.rpc("reserve_rag_question", { target_project: project.id }); databaseFailure(error); },
      rewrite: async (question, history) => (await structuredResponse(z.strictObject({ question: z.string().min(3).max(2500) }), "retrieval_question",
        rewritePrompt, { question, history })).question,
      embed: (texts) => embedTexts(texts, undefined, "query"),
      searchText: async (question, count) => {
        const { data, error } = await supabase.rpc("search_project_documents_text", { target_project: project.id, search_query: question, match_count: count });
        databaseFailure(error); return (data ?? []) as Source[];
      },
      search: async (vector, count) => {
        const { data, error } = await supabase.rpc("search_project_documents", { target_project: project.id, query_embedding: JSON.stringify(vector), match_count: count });
        databaseFailure(error); return (data ?? []) as Source[];
      },
      answer: async (question, sources) => structuredResponse(answerSchema, "grounded_answer",
        answerPrompt, { question, sources }),
      stillAvailable: async (ids) => {
        const { data, error } = await supabase.from("document_chunks").select("id").eq("project_id", project.id).in("id", ids);
        databaseFailure(error); return (data ?? []).map((row) => row.id);
      },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return httpError(error); }
}
