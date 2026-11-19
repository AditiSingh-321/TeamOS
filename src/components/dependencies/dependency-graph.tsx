"use client";

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, type Node, type NodeProps } from "@xyflow/react";
import { ArrowRight, GitBranch } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PriorityBadge, TaskStatusBadge } from "@/components/tasks/task-badges";
import { fieldClass } from "@/components/workspaces/styles";
import { saveDependency } from "@/lib/dependencies/actions";
import { blockedTaskIds, downstreamTasks, graphPositions, topologicalSort, validateDependency, type DependencyEdge } from "@/lib/dependencies/graph";
import { canEditTask } from "@/lib/tasks/permissions";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";
import type { WorkspaceSummary } from "@/types/team";
import "@xyflow/react/dist/style.css";

type TaskNode = Node<{ task: Task; blocked: boolean; affected: boolean; risk?: boolean }, "task">;

function DependencyTaskNode({ data, selected, isConnectable }: NodeProps<TaskNode>) {
  const router = useRouter();
  return (
    <Card className={cn("w-60 space-y-2.5 rounded-xl border p-4", data.blocked && "border-amber-400 bg-amber-soft", data.risk && "border-rose-400 bg-rose-soft", data.affected && "ring-2 ring-primary/60 ring-offset-3", selected && "outline-2 outline-primary")}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} aria-label="Prerequisites" />
      <button type="button" onClick={(event) => {
        event.stopPropagation();
        router.push(`/dependencies?project=${data.task.project_id}&task=${data.task.id}`, { scroll: false });
      }} className="nodrag nowheel break-words rounded text-left text-sm font-semibold hover:text-primary hover:underline">{data.task.title}</button>
      <div className="flex flex-wrap gap-1.5"><TaskStatusBadge status={data.task.status} /><PriorityBadge priority={data.task.priority} /></div>
      {data.risk && <p className="text-xs font-semibold text-rose-700">Active risk on this task</p>}
      {data.blocked && <p className="text-xs font-medium text-amber-900">Blocked by an unfinished prerequisite</p>}
      {data.affected && <p className="text-xs font-medium text-violet-800">Potentially affected downstream task</p>}
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} aria-label="Dependent tasks" />
    </Card>
  );
}

const nodeTypes = { task: DependencyTaskNode };

export function DependencyGraph({ tasks, edges, workspace, projectId, userId, riskSources = [], riskAffected = [] }: {
  riskSources?: string[];
  riskAffected?: string[];
  tasks: Task[];
  edges: DependencyEdge[];
  workspace: WorkspaceSummary;
  projectId: string;
  userId: string;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [delayedId, setDelayedId] = useState("");
  const [notice, setNotice] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const order = useMemo(() => topologicalSort(tasks, edges), [tasks, edges]);
  const positions = useMemo(() => graphPositions(tasks, edges), [tasks, edges]);
  const blocked = useMemo(() => blockedTaskIds(tasks, edges), [tasks, edges]);
  const affected = useMemo(() => [...new Set([...riskAffected,...(delayedId ? downstreamTasks(tasks, edges, delayedId) : [])])], [tasks, edges, delayedId,riskAffected]);
  const [nodes, , onNodesChange] = useNodesState<TaskNode>(tasks.map((task) => ({
    id: task.id, type: "task", position: positions.get(task.id)!, data: { task, blocked: blocked.has(task.id), affected: false, risk: riskSources.includes(task.id) },
  })));
  const peopleTasks = new Map(tasks.map((task) => [task.id, task]));
  const editableTargets = tasks.filter((task) => canEditTask(workspace.role, userId, task));
  const openTask = (id: string) => router.push(`/dependencies?project=${projectId}&task=${id}`, { scroll: false });

  function submitEdge(source: string, target: string, remove = false) {
    if (pending) return;
    if (!remove) {
      const invalid = validateDependency(tasks, edges, { source_id: source, target_id: target });
      if (invalid) { setNotice({ error: invalid }); return; }
    }
    setNotice({});
    startTransition(async () => {
      try {
        const result = await saveDependency({ workspaceId: workspace.id, projectId, sourceId: source, targetId: target }, remove);
        setNotice(result);
        router.refresh();
      } catch {
        setNotice({ error: "Could not change the dependency. Try again." });
      }
    });
  }

  const flowEdges = edges.map((edge) => ({
    id: `${edge.source_id}:${edge.target_id}`, source: edge.source_id, target: edge.target_id,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: affected.includes(edge.target_id) && (edge.source_id === delayedId || riskSources.includes(edge.source_id) || affected.includes(edge.source_id)) ? "var(--primary)" : "var(--edge)", strokeWidth: 2 },
  }));

  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="panel-heading flex items-center gap-2"><GitBranch size={18} className="text-primary" aria-hidden="true"/>Dependency map</h2><p className="flex items-center gap-2 text-xs text-muted-foreground">Prerequisite<ArrowRight size={14} aria-hidden="true"/>Dependent task</p></div><div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-ink"/>Blocked</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-ink"/>Active risk</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary"/>Downstream impact</span><span>Select a task for details</span></div>
        {editableTargets.length > 0 && (
          <form onSubmit={(event) => { event.preventDefault(); submitEdge(sourceId, targetId); }} className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 max-w-full flex-1 gap-1.5 text-xs font-medium text-muted-foreground">Prerequisite
              <select aria-label="Prerequisite task" required value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={pending} className={cn(fieldClass, "w-full")}>
                <option value="">Choose a task</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 max-w-full flex-1 gap-1.5 text-xs font-medium text-muted-foreground">Dependent task
              <select aria-label="Dependent task" required value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={pending} className={cn(fieldClass, "w-full")}>
                <option value="">Choose a task</option>
                {editableTargets.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <button type="submit" disabled={pending} className="ui-primary disabled:opacity-60">{pending ? "Saving…" : "Add dependency"}</button>
          </form>
        )}
        {notice.error && <p role="alert" className="text-sm text-destructive">{notice.error}</p>}
        <p role="status" className="text-sm text-emerald-800">{notice.message}</p>
      </Card>
      <div className="h-[420px] overflow-hidden sm:h-[520px] rounded-2xl border bg-background shadow-inner" aria-label="Task dependency graph">
        <ReactFlow<TaskNode> nodes={nodes.map((node) => ({ ...node, data: { ...node.data, affected: affected.includes(node.id), risk: riskSources.includes(node.id) } }))}
          edges={flowEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
          onNodeClick={(_, node) => openTask(node.id)}
          onConnect={(connection) => submitEdge(connection.source, connection.target)}
          isValidConnection={(connection) => !pending && Boolean(connection.source && connection.target)
            && Boolean(peopleTasks.get(connection.target) && canEditTask(workspace.role, userId, peopleTasks.get(connection.target)!))
            && validateDependency(tasks, edges, { source_id: connection.source, target_id: connection.target }) === null}
          nodesConnectable={!pending && editableTargets.length > 0}
          nodesDraggable fitView minZoom={0.2} maxZoom={2} deleteKeyCode={null} edgesReconnectable={false}>
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="panel-heading">Delay impact</h2>
          <label className="grid gap-1 text-sm font-medium">If this task is delayed
            <select aria-label="Delayed task" value={delayedId} onChange={(event) => setDelayedId(event.target.value)} className={cn(fieldClass, "w-full")}>
              <option value="">Choose a task</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
          {delayedId && <p className="text-sm text-muted-foreground">{affected.length} downstream {affected.length === 1 ? "task" : "tasks"} connected to this task.</p>}
          {affected.length > 0 && <ul className="space-y-2">{affected.map((id) => (
            <li key={id} className="py-2"><button type="button" onClick={() => openTask(id)} className="rounded text-left text-sm text-primary hover:underline">{peopleTasks.get(id)!.title}</button></li>
          ))}</ul>}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="panel-heading">Prerequisite order</h2>
          <ol className="list-inside list-decimal divide-y text-sm marker:text-muted-foreground">{order.map((id) => (
            <li key={id} className="py-2"><button type="button" onClick={() => openTask(id)} className="rounded text-left text-primary hover:underline">{peopleTasks.get(id)!.title}</button></li>
          ))}</ol>
        </Card>
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="panel-heading">Dependencies</h2>
        {!edges.length && <p className="text-sm text-muted-foreground">No dependencies yet. Add one using the form or drag between node handles.</p>}
        <ul className="divide-y">{edges.map((edge) => (
          <li key={`${edge.source_id}:${edge.target_id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="min-w-0 break-words">{peopleTasks.get(edge.target_id)!.title} depends on {peopleTasks.get(edge.source_id)!.title}</span>
            {canEditTask(workspace.role, userId, peopleTasks.get(edge.target_id)!) && <button type="button" disabled={pending}
              onClick={() => submitEdge(edge.source_id, edge.target_id, true)} className="rounded font-medium text-destructive hover:underline disabled:opacity-60"
              aria-label={`Remove dependency from ${peopleTasks.get(edge.source_id)!.title} to ${peopleTasks.get(edge.target_id)!.title}`}>Remove</button>}
          </li>
        ))}</ul>
      </Card>
    </div>
  );
}
