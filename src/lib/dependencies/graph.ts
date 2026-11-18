export interface DependencyEdge {
  source_id: string;
  target_id: string;
}

export interface GraphTask {
  id: string;
  project_id: string | null;
  status: string;
}

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function adjacency(tasks: readonly GraphTask[], edges: readonly DependencyEdge[]) {
  const nodes = new Map(tasks.map((task) => [task.id, task]));
  if (nodes.size !== tasks.length) throw new Error("Duplicate task IDs.");
  const outgoing = new Map(tasks.map(({ id }) => [id, new Set<string>()]));
  const incoming = new Map(tasks.map(({ id }) => [id, new Set<string>()]));

  for (const edge of edges) {
    const source = nodes.get(edge.source_id);
    const target = nodes.get(edge.target_id);
    if (!source || !target) throw new Error("Dependency references an unavailable task.");
    if (source.id === target.id) throw new Error("A task cannot depend on itself.");
    if (!source.project_id || source.project_id !== target.project_id) throw new Error("Dependencies must stay within one project.");
    outgoing.get(source.id)!.add(target.id);
    incoming.get(target.id)!.add(source.id);
  }
  return { nodes, outgoing, incoming };
}

/** Kahn's algorithm with ID ordering for deterministic ties. Includes isolated tasks. */
export function topologicalSort(tasks: readonly GraphTask[], edges: readonly DependencyEdge[]): string[] {
  const { outgoing, incoming } = adjacency(tasks, edges);
  const indegree = new Map([...incoming].map(([id, sources]) => [id, sources.size]));
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareIds);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const target of outgoing.get(id)!) {
      const degree = indegree.get(target)! - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        ready.push(target);
        ready.sort(compareIds);
      }
    }
  }
  if (order.length !== tasks.length) throw new Error("Dependency graph contains a cycle.");
  return order;
}

/** Breadth-first traversal, deduplicated and returned in topological order. */
export function downstreamTasks(tasks: readonly GraphTask[], edges: readonly DependencyEdge[], sourceId: string): string[] {
  const order = topologicalSort(tasks, edges);
  const { outgoing, nodes } = adjacency(tasks, edges);
  if (!nodes.has(sourceId)) throw new Error("Task is unavailable.");
  const visited = new Set<string>([sourceId]);
  const queue = [sourceId];
  for (let index = 0; index < queue.length; index++) {
    for (const target of outgoing.get(queue[index])!) {
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return order.filter((id) => id !== sourceId && visited.has(id));
}

export function validateDependency(tasks: readonly GraphTask[], edges: readonly DependencyEdge[], candidate: DependencyEdge): string | null {
  if (edges.some((edge) => edge.source_id === candidate.source_id && edge.target_id === candidate.target_id)) return "This dependency already exists.";
  try {
    topologicalSort(tasks, [...edges, candidate]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid dependency.";
  }
}

/** An unfinished task is blocked if any immediate prerequisite is unfinished. */
export function blockedTaskIds(tasks: readonly GraphTask[], edges: readonly DependencyEdge[]): Set<string> {
  topologicalSort(tasks, edges);
  const { nodes } = adjacency(tasks, edges);
  return new Set(edges.filter((edge) => nodes.get(edge.target_id)!.status !== "Done" && nodes.get(edge.source_id)!.status !== "Done").map((edge) => edge.target_id));
}

/** Layer each node after its deepest prerequisite for a deterministic DAG layout. */
export function graphPositions(tasks: readonly GraphTask[], edges: readonly DependencyEdge[]) {
  const order = topologicalSort(tasks, edges);
  const { incoming } = adjacency(tasks, edges);
  const depth = new Map<string, number>();
  const rows = new Map<number, number>();
  return new Map(order.map((id) => {
    const column = Math.max(0, ...[...incoming.get(id)!].map((source) => depth.get(source)! + 1));
    depth.set(id, column);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return [id, { x: column * 320, y: row * 160 }];
  }));
}
