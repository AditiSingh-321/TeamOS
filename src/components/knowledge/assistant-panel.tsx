"use client";
import { useRef, useState } from "react";
import { BookOpen, Send, Sparkles, Plus, LoaderCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { primaryLinkClass } from "@/components/workspaces/styles";
import type { ChatAnswer } from "@/lib/knowledge/validation";
const starters = ["What are the main project requirements?", "Summarize the architecture documentation.", "Which technologies are specified in the project?", "What important decisions are documented?", "Explain the deployment process."];
type Message = { role: "user" | "assistant"; content: string; result?: ChatAnswer };
export function AssistantPanel({ project, retrieval }: { project: { id: string; name: string }; retrieval: "fulltext" | "semantic" }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const lock = useRef(false);
  async function ask(value: string) {
    const text = value.trim(); if (text.length < 3 || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setQuestion(text);
    try {
      const response = await fetch(`/api/projects/${project.id}/ai-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(180000), body: JSON.stringify({ question: text, history: messages.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 6000) })) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessages((old) => [...old, { role: "user", content: text }, { role: "assistant", content: data.answer, result: data }]); setQuestion("");
    } catch (err) { setError(err instanceof Error && err.name === "TimeoutError" ? "The assistant timed out. Please retry your question." : err instanceof Error ? err.message : "The answer could not be loaded."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Card className="flex min-h-[620px] min-w-0 flex-col overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4"><div className="flex min-w-0 items-center gap-2"><Sparkles size={18} className="shrink-0 text-primary" /><h2 className="truncate text-sm font-semibold">{project.name}</h2></div><button type="button" disabled={busy} onClick={() => { setMessages([]); setError(""); setQuestion(""); }} className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"><Plus size={14} />New chat</button></div>
    <div aria-live="polite" aria-busy={busy} className="max-h-[65dvh] flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
      {!messages.length && <div className="mx-auto max-w-xl py-6"><BookOpen className="mb-4 text-primary" size={30} /><h3 className="text-xl font-semibold">Ask your project documents</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Find requirements, decisions, and technical details with verifiable sources. Upload documents and wait for Ready before asking.</p>{retrieval === "fulltext" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Search matches words in your documents. Include specific names or terms from the source in your question.</p>}<div className="mt-6 grid gap-2">{starters.map((starter) => <button key={starter} type="button" disabled={busy} onClick={() => void ask(starter)} className="rounded-lg border p-3 text-left text-sm transition-colors hover:border-violet-200 hover:bg-violet-50 disabled:opacity-50">{starter}</button>)}</div></div>}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "ml-auto max-w-[90%] rounded-xl bg-violet-50 p-4" : "max-w-full rounded-xl border p-4"}>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{message.role === "user" ? "You" : "TeamOS"}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p>
        {message.result?.taskReferences?.length ? <div className="mt-3 space-y-1 border-t pt-3"><p className="text-xs font-semibold">Live task records</p>{message.result.taskReferences.map(task=><a key={task.id} href={`/my-tasks?task=${task.id}`} className="block text-xs text-primary hover:underline">{task.title}</a>)}</div> : null}
        {message.result?.citations.length ? <div className="mt-4 space-y-2 border-t pt-3"><p className="text-xs font-semibold">Sources</p>{message.result.citations.map((citation) => <details key={citation.id} className="rounded-md bg-background p-3 text-xs"><summary className="cursor-pointer break-words text-primary">[{citation.marker}] {citation.filename}{citation.page_number ? ` — Page ${citation.page_number}` : citation.section_title ? ` — ${citation.section_title}` : ""}</summary><blockquote className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{citation.content}</blockquote><a className="mt-2 inline-block text-primary hover:underline" href={citation.meeting_id ? `/meetings/${citation.meeting_id}?project=${project.id}` : `/api/projects/${project.id}/documents/${citation.document_id}${citation.page_number ? `#page=${citation.page_number}` : ""}`} target="_blank" rel="noopener noreferrer">Open original source ↗</a></details>)}</div> : null}
      </div>)}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />Searching documents and preparing an answer…</p>}
    </div>
    <div className="border-t p-4">
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} Your question is kept below so you can retry.</p>}
      <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="space-y-2"><label htmlFor="rag-question" className="sr-only">Question about project documents</label><textarea id="rag-question" value={question} maxLength={2000} disabled={busy} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }} placeholder="Ask about this project's documents…" rows={3} className="w-full resize-y rounded-lg border bg-background p-3 text-sm disabled:opacity-50" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p><button type="submit" disabled={busy || question.trim().length < 3} className={`${primaryLinkClass} gap-2 disabled:opacity-50`}><Send size={14} />{error ? "Retry question" : "Ask question"}</button></div></form>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Review cited excerpts. AI can misinterpret evidence. Chat stays in this tab and clears when you switch projects or refresh.</p>
    </div>
  </Card>;
}
