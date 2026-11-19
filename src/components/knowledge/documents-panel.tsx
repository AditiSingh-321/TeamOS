"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FileText, Upload, LoaderCircle } from "lucide-react";

import { Card } from "@/components/ui/card";

import { primaryLinkClass } from "@/components/workspaces/styles";

import { validateUpload, type DocumentRecord } from "@/lib/knowledge/validation";

export function DocumentsPanel({ project, userId, manager }: { project: { id: string; name: string }; userId: string; manager: boolean }) {

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [uploading, setUploading] = useState(false);

  const [progress, setProgress] = useState(0);

  const [busy, setBusy] = useState<string | null>(null);

  const [notice, setNotice] = useState("");

  const input = useRef<HTMLInputElement>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const base = `/api/projects/${project.id}/documents`;

  const refresh = useCallback(async (signal?: AbortSignal) => {

    try {

      const response = await fetch(base, { signal }); const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setDocuments(data.documents); setLoading(false);

    } catch (error) { if (!signal?.aborted) { setLoading(false); setError(error instanceof Error ? error.message : "Could not load documents."); } }

  }, [base]);

  useEffect(() => {

    const controller = new AbortController();

    const initial = setTimeout(() => { void refresh(controller.signal); }, 0);

    const timer = setInterval(() => { void refresh(controller.signal); }, 5000);

    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); xhrRef.current?.abort(); };

  }, [refresh]);

  async function upload(file?: File) {

    if (!file || uploading) return;

    try { validateUpload(file.name, file.size); } catch (err) { setError((err as Error).message); return; }

    setError(""); setNotice(""); setUploading(true); setProgress(0);

    const form = new FormData(); form.append("file", file);

    try {

      await new Promise<void>((resolve, reject) => {

        const xhr = new XMLHttpRequest(); xhrRef.current = xhr;

        xhr.open("POST", base); xhr.timeout = 60000;

        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };

        xhr.onerror = () => reject(new Error("Upload failed. Check your connection and retry."));

        xhr.ontimeout = () => reject(new Error("Upload timed out. Refresh the list before retrying."));

        xhr.onabort = () => reject(new Error("Upload cancelled."));

        xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(data.error || "Upload failed.")); } catch { reject(new Error("Upload failed. Please retry.")); } };

        xhr.send(form);

      });

      setNotice("Uploaded. The document worker will process it shortly."); await refresh();

    } catch (err) { setError((err as Error).message); }

    finally { setUploading(false); if (input.current) input.current.value = ""; }

  }

  async function action(doc: DocumentRecord, operation: "delete" | "retry") {

    if (operation === "delete" && !window.confirm(`Delete ${doc.filename} and its indexed content?`)) return;

    setBusy(doc.id); setError(""); setNotice("");

    try {

      const response = await fetch(`${base}/${doc.id}${operation === "retry" ? "/retry" : ""}`, { method: operation === "delete" ? "DELETE" : "POST" });

      const data = await response.json(); if (!response.ok) throw new Error(data.error);

      setNotice(operation === "delete" ? "Removed from search. Private file cleanup is queued." : "Processing queued again."); await refresh();

    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }

  }

  return <div className="min-w-0 space-y-4">

    <Card className="ai-surface border-dashed border-primary/25 p-7 text-center sm:p-10" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>

      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-white bg-violet-soft shadow-sm"><Upload className="text-primary" size={23} strokeWidth={1.6} aria-hidden="true"/></span>

      <h2 className="font-semibold">Add knowledge to {project.name}</h2>

      <p className="my-2 text-sm text-muted-foreground">Drop a file here, or browse. PDF, DOCX, TXT, Markdown · up to 3 MB.</p>

      <p className="mb-4 text-xs text-muted-foreground">PDFs need selectable text. Files stay private to your workspace.</p>

      <input ref={input} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Choose project document" onChange={(e) => void upload(e.target.files?.[0])} disabled={uploading} />

      <button type="button" className={primaryLinkClass} disabled={uploading} onClick={() => input.current?.click()}>{uploading ? "Uploading…" : "Browse files"}</button>

      {uploading && <div className="mx-auto mt-3 max-w-xs"><progress value={progress} max={100} className="w-full accent-violet-600" aria-label="File upload progress" /><p className="text-xs text-muted-foreground">{progress}% uploaded{progress === 100 ? " · saving and queuing…" : ""}</p></div>}

    </Card>

    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => { setError(""); void refresh(); }}>Refresh documents</button></div>}

    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

    <Card className="overflow-hidden">

      <div className="section-header"><h2 className="panel-heading">Project documents <span className="ml-1 text-sm font-normal text-muted-foreground">{documents.length}</span></h2></div>

      {loading ? <p role="status" className="flex gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />Loading documents…</p> : !documents.length ? <div className="p-10 text-center"><FileText className="mx-auto mb-3 text-muted-foreground" /><p className="text-sm text-muted-foreground">Upload your first document to build this project knowledge.</p><button type="button" onClick={() => input.current?.click()} className="mt-3 text-sm text-primary hover:underline">Upload document</button></div> :

      <ul className="divide-y">{documents.map((doc) => <li key={doc.id} className="space-y-3 p-5 transition-colors hover:bg-background/60">

        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{doc.filename}</p><p className="mt-1 text-xs text-muted-foreground">{doc.filename.split(".").at(-1)?.toUpperCase()} · {(doc.file_size / 1024).toFixed(1)} KB · {new Date(doc.created_at).toLocaleDateString()} · {doc.uploaded_by_name}</p><p className="mt-1 text-xs text-muted-foreground">{project.name}</p></div><span className={`rounded-full px-2 py-1 text-xs ${doc.processing_status === "Ready" ? "bg-green-soft text-green-ink" : doc.processing_status === "Failed" ? "bg-rose-soft text-rose-ink" : "bg-violet-soft text-violet-ink"}`}>{doc.processing_status}</span></div>

        {doc.error_message && <p className="text-xs text-destructive">{doc.error_message}</p>}

        <div className="flex flex-wrap gap-4 text-xs"><a href={`${base}/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View original</a><a href={`${base}/${doc.id}?download=1`} className="text-primary hover:underline">Download</a>{(manager || doc.uploaded_by === userId) && <>{["Failed", "Ready"].includes(doc.processing_status) && <button type="button" disabled={busy === doc.id} onClick={() => void action(doc, "retry")} className="text-primary hover:underline disabled:opacity-50">{doc.processing_status === "Ready" ? "Re-index" : "Retry processing"}</button>}<button type="button" disabled={busy === doc.id} onClick={() => void action(doc, "delete")} className="text-destructive hover:underline disabled:opacity-50">{busy === doc.id ? "Working…" : "Delete"}</button></>}</div>

      </li>)}</ul>}

    </Card>

  </div>;

}
