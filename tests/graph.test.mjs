import assert from "node:assert/strict";
import test from "node:test";
import { blockedTaskIds, downstreamTasks, graphPositions, topologicalSort, validateDependency } from "../src/lib/dependencies/graph.ts";

const task = (id, project_id = "project", status = "To Do") => ({ id, project_id, status });
const tasks = ["a", "b", "c", "d", "isolated"].map((id) => task(id));
const edges = [
  { source_id: "a", target_id: "b" },
  { source_id: "a", target_id: "c" },
  { source_id: "b", target_id: "d" },
  { source_id: "c", target_id: "d" },
];

test("topological order respects prerequisites and is stable across input permutations", () => {
  assert.deepEqual(topologicalSort(tasks, edges), ["a", "b", "c", "d", "isolated"]);
  assert.deepEqual(topologicalSort([...tasks].reverse(), [...edges].reverse()), topologicalSort(tasks, edges));
  assert.deepEqual(topologicalSort([], []), []);
  assert.deepEqual(topologicalSort([task("z"), task("a")], []), ["a", "z"]);
});

test("downstream traversal deduplicates diamonds, excludes source and disconnected nodes", () => {
  assert.deepEqual(downstreamTasks(tasks, edges, "a"), ["b", "c", "d"]);
  assert.deepEqual(downstreamTasks(tasks, edges, "b"), ["d"]);
  assert.deepEqual(downstreamTasks(tasks, edges, "d"), []);
  assert.deepEqual(downstreamTasks(tasks, edges, "isolated"), []);
  assert.throws(() => downstreamTasks(tasks, edges, "missing"), /unavailable/);
});

test("invalid edges reject self-links, duplicates, missing tasks and cycles", () => {
  assert.match(validateDependency(tasks, edges, { source_id: "a", target_id: "a" }), /itself/);
  assert.match(validateDependency(tasks, edges, edges[0]), /already exists/);
  assert.match(validateDependency(tasks, edges, { source_id: "unknown", target_id: "a" }), /unavailable/);
  assert.match(validateDependency(tasks, edges, { source_id: "d", target_id: "a" }), /cycle/);
  assert.match(validateDependency(tasks, edges, { source_id: "b", target_id: "a" }), /cycle/);
  assert.equal(validateDependency(tasks, edges, { source_id: "d", target_id: "isolated" }), null);
});

test("dependencies cannot cross projects or include tasks without a project", () => {
  for (const project of ["other", null]) {
    assert.match(validateDependency([task("a"), task("b", project)], [], { source_id: "a", target_id: "b" }), /one project/);
  }
  assert.match(validateDependency([task("a", null), task("b", null)], [], { source_id: "a", target_id: "b" }), /one project/);
});

test("malformed graph input fails explicitly instead of returning incomplete analysis", () => {
  assert.throws(() => topologicalSort([task("a"), task("a")], []), /Duplicate/);
  assert.throws(() => topologicalSort(tasks, [...edges, { source_id: "d", target_id: "a" }]), /cycle/);
  assert.throws(() => graphPositions(tasks, [{ source_id: "missing", target_id: "a" }]), /unavailable/);
});

test("blocked tasks depend on unfinished prerequisites, and Done tasks are excluded", () => {
  assert.deepEqual([...blockedTaskIds(tasks, edges)].sort(), ["b", "c", "d"]);
  const changed = tasks.map((entry) => ({ ...entry, status: entry.id === "a" || entry.id === "b" ? "Done" : entry.status }));
  assert.deepEqual([...blockedTaskIds(changed, edges)], ["d"]);
  assert.deepEqual([...blockedTaskIds(tasks.map((entry) => ({ ...entry, status: "Done" })), edges)], []);
});

test("layout uses deepest prerequisite and deterministic sibling rows", () => {
  const positions = graphPositions(tasks, edges);
  assert.equal(positions.get("a").x, 0);
  assert.equal(positions.get("b").x, 320);
  assert.equal(positions.get("d").x, 640);
  assert.notEqual(positions.get("b").y, positions.get("c").y);
  assert.deepEqual(graphPositions([...tasks].reverse(), [...edges].reverse()), positions);
});

test("iterative traversal handles long chains without recursive stack overflow", () => {
  const chain = Array.from({ length: 12000 }, (_, index) => task(String(index).padStart(5, "0")));
  const links = chain.slice(1).map((entry, index) => ({ source_id: chain[index].id, target_id: entry.id }));
  assert.equal(topologicalSort(chain, links).length, chain.length);
  assert.equal(downstreamTasks(chain, links, chain[0].id).length, chain.length - 1);
});
