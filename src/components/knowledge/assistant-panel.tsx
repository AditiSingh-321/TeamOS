"use client";
import { useRef, useState } from "react";
import { Send, Sparkles, Plus, LoaderCircle } from "lucide-react";
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
  return <Card className="flex min-h-[540px] min-w-0 flex-col overflow-hidden">
    <div className="ai-surface flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div className="flex min-w-0 items-center gap-2"><Sparkles size={18} className="shrink-0 text-primary" /><h2 className="truncate text-sm font-semibold">{project.name}</h2></div><button type="button" disabled={busy} onClick={() => { setMessages([]); setError(""); setQuestion(""); }} className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"><Plus size={14} />New chat</button></div>
    <div aria-live="polite" aria-busy={busy} className="sm:max-h-[65dvh] flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
      {!messages.length && <div className="mx-auto max-w-xl py-3 sm:py-4"><span className="mb-3 grid size-11 place-items-center rounded-2xl border border-white bg-violet-soft shadow-sm"><Sparkles className="text-primary" size={21} strokeWidth={1.5} aria-hidden="true"/></span><h3 className="text-[1.4rem] font-semibold tracking-[-0.035em]">A clearer picture of your project</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Explore requirements and decisions with verifiable sources. Documents must be Ready before asking.</p>{retrieval === "fulltext" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Search matches words in your documents. Include specific names or terms from the source in your question.</p>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{starters.map((starter) => <button key={starter} type="button" disabled={busy} onClick={() => void ask(starter)} className="rounded-xl border bg-card p-3 text-left text-xs leading-5 shadow-xs transition-colors hover:border-primary/30 hover:bg-violet-soft/30 disabled:opacity-50">{starter}</button>)}</div></div>}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "ml-auto max-w-[90%] rounded-2xl rounded-tr-md bg-violet-soft/70 p-4" : "max-w-full rounded-2xl rounded-tl-md border bg-card p-5 shadow-xs"}>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{message.role === "user" ? "You" : "TeamOS"}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p>
        {message.result?.taskReferences?.length ? <div className="mt-3 space-y-1 border-t pt-3"><p className="text-xs font-semibold">Live task records</p>{message.result.taskReferences.map(task=><a key={task.id} href={`/my-tasks?task=${task.id}`} className="block text-xs text-primary hover:underline">{task.title}</a>)}</div> : null}
        {message.result?.citations.length ? <div className="mt-4 space-y-2 border-t pt-3"><p className="text-xs font-semibold">Sources</p>{message.result.citations.map((citation) => <details key={citation.id} className="rounded-xl border bg-background/80 p-3 text-xs"><summary className="cursor-pointer break-words text-primary">[{citation.marker}] {citation.filename}{citation.page_number ? ` — Page ${citation.page_number}` : citation.section_title ? ` — ${citation.section_title}` : ""}</summary><blockquote className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{citation.content}</blockquote><a className="mt-2 inline-block text-primary hover:underline" href={citation.meeting_id ? `/meetings/${citation.meeting_id}?project=${project.id}` : `/api/projects/${project.id}/documents/${citation.document_id}${citation.page_number ? `#page=${citation.page_number}` : ""}`} target="_blank" rel="noopener noreferrer">Open original source ↗</a></details>)}</div> : null}
      </div>)}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />Searching documents and preparing an answer…</p>}
    </div>
    <div className="border-t bg-background/50 p-4">
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} Your question is kept below so you can retry.</p>}
      <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="space-y-2"><label htmlFor="rag-question" className="sr-only">Question about project documents</label><textarea id="rag-question" value={question} maxLength={2000} disabled={busy} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }} placeholder="Ask about this project's documents…" rows={2} className="w-full resize-y rounded-xl border bg-card p-3 text-sm shadow-xs disabled:opacity-50" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p><button type="submit" disabled={busy || question.trim().length < 3} className={`${primaryLinkClass} gap-2 disabled:opacity-50`}><Send size={14} />{error ? "Retry question" : "Ask question"}</button></div></form>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Review cited excerpts. AI can misinterpret evidence. Chat stays in this tab and clears when you switch projects or refresh.</p>
    </div>
  </Card>;
}
