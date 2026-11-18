import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { generateDraft } from "../src/lib/planner/service.ts";
import { generatePlan } from "../src/lib/planner/sarvam.ts";
import { validatePlan } from "../src/lib/planner/schema.ts";
import { plannedTaskInput } from "../src/lib/tasks/planned-task.ts";
import { input, plan } from "./planner-fixtures.mjs";

test("planner integration and PostgreSQL approval security", async (t) => {
  const db = await PGlite.create();
  const owner = "f6000000-0000-4000-8000-000000000001";
  const member = "f6000000-0000-4000-8000-000000000002";
  const outsider = "f6000000-0000-4000-8000-000000000003";
  let project;
  let workspace;
  let savedId;
  let mapping;
  const asUser = async (user) => {
    await db.exec("reset role; set role authenticated;");
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  };
  const rpc = async (name, args) => {
    // Names and argument lists in this adapter are fixed test code.
    const placeholders = args.map((_, index) => "$" + (index + 1)).join(", ");
    return (await db.query("select public." + name + "(" + placeholders + ") as result", args)).rows[0].result;
  };
  const freshBudget = async () => {
    await db.exec("reset role; update public.ai_project_plans set created_at = clock_timestamp() - interval '11 minutes';");
    await asUser(owner);
  };
  const createDraft = async (candidate = plan) => {
    await freshBudget();
    const id = crypto.randomUUID();
    await rpc("reserve_ai_plan", [project.id, id, input.brief, {}]);
    await rpc("finish_ai_plan", [id, candidate]);
    return id;
  };

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to anon, authenticated;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        'select (nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'')::uuid';
    `);
    for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    }
    for (const file of ["workspace_isolation.sql", "task_management.sql", "task_dependencies.sql"]) {
      await db.exec(await readFile("supabase/tests/" + file, "utf8"));
    }
    await db.query("insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values ($1, 'planner-owner@example.com', now(), '{}'), ($2, 'planner-member@example.com', now(), '{}'), ($3, 'planner-outsider@example.com', now(), '{}')", [owner, member, outsider]);
    await asUser(owner);
    workspace = await rpc("create_workspace", ["Planner workspace"]);
    project = (await db.query("insert into public.projects(workspace_id, name) values ($1, 'Store') returning id, workspace_id, name, description", [workspace])).rows[0];
    await db.query("insert into public.tasks(workspace_id, project_id, title, status) values ($1, $2, 'Existing manual task', 'Done')", [workspace, project.id]);

    const pipeline = (candidate) => ({
      authorize: async (id) => {
        const result = await db.query("select p.id, p.workspace_id, p.name, p.description from public.projects p join public.workspace_members m on m.workspace_id = p.workspace_id where p.id = $1 and m.user_id = auth.uid() and m.role in ('owner', 'admin')", [id]);
        if (!result.rows[0]) throw new Error("Unauthorized project");
        return result.rows[0];
      },
      reserve: async (target, data, request) => {
        const { brief, ...preferences } = data;
        return rpc("reserve_ai_plan", [target.id, request, brief, preferences]);
      },
      generate: async (data, target) => generatePlan(data, target, {
        responses: { parse: async (parameters) => {
          assert.equal(parameters.text.format.type, "json_schema");
          return { status: "completed", output: [], output_parsed: candidate };
        } },
      }),
      finish: async (id, data) => rpc("finish_ai_plan", [id, data]),
      fail: async (id) => rpc("fail_ai_plan", [id]),
    });

    await t.test("brief to structured draft to approval persists existing task entities and real dependency IDs", async () => {
      savedId = crypto.randomUUID();
      await generateDraft(project.id, savedId, input, pipeline(plan));
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 1);
      const draft = (await db.query("select * from public.ai_project_plans where id = $1", [savedId])).rows[0];
      assert.equal(draft.status, "draft");
      const edited = structuredClone(draft.generated_plan);
      edited.tasks[0].title = "Edited catalog implementation";
      const revision = await rpc("edit_ai_plan", [savedId, 1, edited, false]);
      assert.equal(revision, 2);
      mapping = await rpc("approve_ai_plan", [savedId, revision, validatePlan(edited)]);
      assert.equal(Object.keys(mapping).length, 2);
      const tasks = (await db.query("select * from public.tasks order by title")).rows;
      assert.equal(tasks.length, 3);
      const imported = tasks.find((task) => task.id === mapping.catalog);
      assert.equal(imported.title, edited.tasks[0].title);
      assert.equal(imported.description, plannedTaskInput(edited.tasks[0], workspace, project.id).description);
      assert.equal(imported.status, "To Do");
      assert.equal(tasks.find((task) => task.title === "Existing manual task").status, "Done");
      const edges = (await db.query("select source_id, target_id from public.task_dependencies")).rows;
      assert.deepEqual(edges, [{ source_id: mapping.catalog, target_id: mapping.checkout }]);
      assert.equal((await db.query("select status from public.ai_project_plans where id = $1", [savedId])).rows[0].status, "approved");
      assert.equal((await db.query("select progress from public.projects where id = $1", [project.id])).rows[0].progress, 33);
      assert.deepEqual(await rpc("workspace_task_counts", [workspace]), { total: 3, done: 1 });
    });

    await t.test("repeated approval and generation request IDs are idempotent", async () => {
      assert.deepEqual(await rpc("approve_ai_plan", [savedId, 0, plan]), mapping);
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 3);
      const deps = pipeline(plan);
      deps.generate = async () => assert.fail("Duplicate request called Sarvam");
      assert.equal(await generateDraft(project.id, savedId, input, deps), savedId);
    });

    await t.test("approval rolls back every task, edge and state change on an insertion failure", async () => {
      const candidate = structuredClone(plan);
      candidate.tasks[1].title = "Reject this task";
      const id = await createDraft(candidate);
      await db.exec(`reset role;
        create function private.test_reject_import() returns trigger language plpgsql as $$
        begin if new.title = 'Reject this task' then raise exception 'forced task failure'; end if; return new; end; $$;
        create trigger test_reject_import before insert on public.tasks for each row execute function private.test_reject_import();
      `);
      await asUser(owner);
      await assert.rejects(rpc("approve_ai_plan", [id, 1, candidate]), /forced task failure/);
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 3);
      assert.equal((await db.query("select count(*)::int as n from public.task_dependencies")).rows[0].n, 1);
      assert.equal((await db.query("select status from public.ai_project_plans where id = $1", [id])).rows[0].status, "draft");
      await db.exec("reset role; drop trigger test_reject_import on public.tasks; drop function private.test_reject_import();");
      await asUser(owner);
    });

    await t.test("dependency insertion failure rolls back imported tasks and approval state", async () => {
      const id = await createDraft();
      await db.exec(`reset role;
        create function private.test_reject_edge() returns trigger language plpgsql as $$
        begin raise exception 'forced dependency failure'; end; $$;
        create trigger test_reject_edge before insert on public.task_dependencies for each row execute function private.test_reject_edge();
      `);
      await asUser(owner);
      await assert.rejects(rpc("approve_ai_plan", [id, 1, plan]), /forced dependency failure/);
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 3);
      assert.equal((await db.query("select count(*)::int as n from public.task_dependencies")).rows[0].n, 1);
      assert.equal((await db.query("select status from public.ai_project_plans where id = $1", [id])).rows[0].status, "draft");
      await db.exec("reset role; drop trigger test_reject_edge on public.task_dependencies; drop function private.test_reject_edge();");
      await asUser(owner);
    });
    await t.test("database rejects cyclic, missing, duplicate and malformed draft data", async () => {
      const id = await createDraft();
      const invalid = [
        { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ["checkout"] }, plan.tasks[1]] },
        { ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], dependsOn: ["missing"] }] },
        { ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], dependsOn: ["catalog", "catalog"] }] },
        { ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], title: plan.tasks[0].title }] },
        { ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], estimatedDays: -1 }] },
      ];
      for (const candidate of invalid) {
        await assert.rejects(rpc("approve_ai_plan", [id, 1, candidate]));
      }
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 3);
      await rpc("edit_ai_plan", [id, 1, null, true]);
      await assert.rejects(rpc("approve_ai_plan", [id, 2, plan]), /Draft changed/);
    });

    await t.test("optimistic revisions reject stale draft edits", async () => {
      const id = await createDraft();
      await rpc("edit_ai_plan", [id, 1, plan, false]);
      await assert.rejects(rpc("edit_ai_plan", [id, 1, plan, false]), /Draft changed/);
      await assert.rejects(rpc("approve_ai_plan", [id, 1, plan]), /Draft changed/);
    });

    await t.test("generation failures persist a failed request with no imported tasks", async () => {
      await freshBudget();
      const id = crypto.randomUUID();
      const deps = pipeline(plan);
      deps.generate = async () => { throw new Error("Mock API failure"); };
      await assert.rejects(generateDraft(project.id, id, input, deps), /Mock API failure/);
      assert.equal((await db.query("select status from public.ai_project_plans where id = $1", [id])).rows[0].status, "failed");
      assert.equal((await db.query("select count(*)::int as n from public.tasks")).rows[0].n, 3);
    });

    await t.test("database rate limit and cancelled generation prevent duplicate or late writes", async () => {
      await freshBudget();
      const id = crypto.randomUUID();
      await rpc("reserve_ai_plan", [project.id, id, input.brief, {}]);
      await assert.rejects(rpc("reserve_ai_plan", [project.id, crypto.randomUUID(), input.brief, {}]), /Generation limit/);
      await rpc("edit_ai_plan", [id, 0, null, true]);
      assert.equal(await rpc("finish_ai_plan", [id, plan]), false);
    });

    await t.test("members and outsiders cannot read, generate, edit or approve project plans", async () => {
      await freshBudget();
      const invitation = (await db.query("insert into public.workspace_invitations(workspace_id, email, role) values ($1, 'planner-member@example.com', 'member') returning id", [workspace])).rows[0].id;
      await asUser(member);
      await rpc("accept_workspace_invitation", [invitation]);
      for (const actor of [member, outsider]) {
        await asUser(actor);
        assert.equal((await db.query("select * from public.ai_project_plans")).rows.length, 0);
        await assert.rejects(rpc("reserve_ai_plan", [project.id, crypto.randomUUID(), input.brief, {}]), /access required/);
        await assert.rejects(rpc("approve_ai_plan", [savedId, 2, plan]), /access required/);
        await assert.rejects(rpc("edit_ai_plan", [savedId, 2, plan, false]), /access required/);
        await assert.rejects(generateDraft(project.id, crypto.randomUUID(), input, pipeline(plan)), /Unauthorized project/);
      }
      await db.exec("reset role; set role anon;");
      await assert.rejects(rpc("approve_ai_plan", [savedId, 2, plan]), /permission denied/);
    });

    await t.test("normal task status updates keep project progress current", async () => {
      await asUser(owner);
      await db.query("update public.tasks set status = 'Done' where id = $1", [mapping.catalog]);
      assert.equal((await db.query("select progress from public.projects where id = $1", [project.id])).rows[0].progress, 67);
    });
  } finally { await db.close(); }
});
