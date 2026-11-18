# TeamOS

TeamOS is a workspace for following projects, tasks, and team activity. Workspaces, projects, tasks, and comments are backed by Supabase PostgreSQL.

## Run locally

Use Node.js 24 and pnpm 11. From this directory, run:

```powershell
pnpm install --frozen-lockfile
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

1. Create a Supabase project. Copy its project URL and **publishable key** from the project's Connect dialog into `.env.local`. Keep service-role and secret keys out of TeamOS.
2. In Supabase **Authentication → Sign In / Providers**, enable Email sign-in, allow new users to sign up, and keep **Confirm email** enabled.
3. In **Authentication → URL Configuration**, set **Site URL** to `http://localhost:3000`. Use this same origin in `TEAMOS_SITE_URL` and in your browser. For production, use your HTTPS app origin.
4. In **Authentication → Email Templates → Confirm signup**, set the confirmation link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. This lets TeamOS verify the link and set the session on the server.
5. Set up custom SMTP if the hosted dashboard requires it to edit templates or if confirmation emails need to reach addresses outside your Supabase organization. For a quick login test, create an auto-confirmed test account in **Authentication → Users**.

```powershell
pnpm dev
```

Open [TeamOS on localhost](http://localhost:3000), sign up, and follow the confirmation link. The login and signup pages display a configuration message if the Supabase URL or publishable key is missing.

[Supabase Next.js authentication guide](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs) · [Supabase SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp)

### Optional Google sign-in

1. In Google Cloud, create a **Web application** OAuth client. Configure its consent screen and add the Supabase provider callback from the Google provider settings as an **Authorized redirect URI**. For a hosted Supabase project it is normally `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the client ID and secret. Store the Google secret in Supabase.
3. Add `http://localhost:3000/auth/callback` to Supabase **Authentication → URL Configuration → Redirect URLs**. Add the exact HTTPS callback URL for each production deployment.
4. Set `TEAMOS_GOOGLE_AUTH_ENABLED=true` in `.env.local` and restart TeamOS. If the Google app is in testing mode, allow the Google accounts you will use as test users.

[Supabase Google OAuth setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

## Phase 3 database setup

1. In the Supabase project connected through `.env.local`, open **SQL Editor → New query**.
2. Run [the Phase 3 migration](supabase/migrations/20261118000000_workspaces_and_projects.sql) once. If you manage this project's migration history through the Supabase CLI, apply the file through your existing migration workflow instead.
3. Sign in to TeamOS and open **Workspaces** to create your first workspace. Use the workspace name in the header or the **Workspaces** sidebar item to return and switch teams.

| Role | Permissions |
| --- | --- |
| Owner | Manage projects, invite admins and members, revoke invitations, and change member/admin roles |
| Admin | Manage projects and invite or revoke invitations for members |
| Member | View workspace members and projects |

Invitations appear in **Workspaces → Your invitations** for the matching verified email address and expire after seven days. Share the TeamOS address with the recipient so they can sign in or create an account and accept. No invitation email is sent.

## Phase 4 task setup

After the Phase 3 migration, run [the Phase 4 migration](supabase/migrations/20261118010000_task_management.sql) once in the same Supabase SQL Editor. Then open **My Tasks** and choose **New task**. Assign it to a workspace member or leave it unassigned. Link it to a project if needed.

Workspace members can create tasks and comment. Owners, admins, and the task creator can edit or delete the task. The assignee can also move it through To Do, In Progress, Review, and Done. Drag the card by its handle or update the status in the task drawer. Use **Assigned to me** in the assignee filter for a personal view.

## Phase 5 dependencies

After Phase 4, run [the Phase 5 migration](supabase/migrations/20261118020000_task_dependencies.sql) once in Supabase SQL Editor.

Open **Dependencies**, choose a project, and add prerequisite → dependent links using node handles or the form. Owners, admins, and the dependent task's creator can add or remove its links. Both tasks must be assigned to that project. Tasks with existing dependencies must have their links removed before moving to another project.

Amber nodes identify unfinished tasks with unfinished immediate prerequisites. Select a node to open its task drawer. The **Prerequisite order** follows deterministic topological sorting. **Delay impact** traverses all downstream links, highlights those tasks, and lists them in prerequisite order, including completed descendants. It reports graph reachability without estimating schedule dates.

Deleting a task removes its edges. Deleting a project removes its edges and retains the existing unlinked tasks.

## Phase 6 AI project planner

1. Apply [the Phase 6 migration](supabase/migrations/20261118030000_ai_project_planner.sql) after the Phase 5 migration.
2. Create a Sarvam AI API key at [the Sarvam dashboard](https://dashboard.sarvam.ai/) and check your available API credits. Put the key in `.env.local` as `SARVAM_API_KEY`. Set `SARVAM_MODEL=sarvam-105b`, or choose another Sarvam Responses API model that supports structured outputs. OpenAI keys are not used. Restart TeamOS after changing environment variables.
3. As a workspace owner or admin, open **Projects → Generate with AI**. Enter a brief of 20–8,000 characters and optional team size, duration, deadline, technology stack, and instructions.
4. Generate a draft, review and edit task cards, change prerequisites, or add and remove tasks. Save edits with **Save draft** and return through **Saved plans** after a refresh. Regeneration creates a new draft.
5. Check the review checkbox, then choose **Approve & Create Tasks**. The import creates normal project tasks and dependency edges in one transaction. Repeating approval returns the existing import.

The default model is configurable. The implementation calls Sarvam at `https://api.sarvam.ai/v2` using its OpenAI-compatible interface, the existing OpenAI JavaScript SDK, `responses.parse`, `zodTextFormat`, and deterministic Phase 5 graph validation. Provider refusals, incomplete responses, invalid graphs, timeouts, and API failures produce error messages.

[Sarvam quickstart](https://docs.sarvam.ai/api/getting-started/quickstart) · [Sarvam Responses API](https://docs.sarvam.ai/api/token-factory/responses-api) · [Authentication](https://docs.sarvam.ai/api-reference/authentication)

### Drafts and imported tasks

Plans have generating, draft, approved, cancelled, or failed states. Requests are reserved before calling Sarvam, so saved requests remain visible if the browser leaves during generation. A generation that does not finish within two minutes can be cancelled and retried. The provider timeout is 75 seconds, automatic provider retries are disabled, and the planner page allows up to 120 seconds where the deployment supports that limit.

Each plan contains at most 30 tasks. Duplicate IDs, duplicate titles, missing prerequisites, repeated edges, self-links, and cycles fail validation. Removing a task clears its references and reports the affected tasks.

Approval checks current permissions and the draft revision, validates again in PostgreSQL, and atomically inserts tasks, dependency edges, and approval state. A failed insert rolls the entire import back. Existing tasks keep their values. Generated tasks start in To Do, are unassigned, and have no due date. Their descriptions include suggested roles, person-day effort estimates, and acceptance criteria. Planning deadlines guide the draft rather than assigning a schedule automatically.

Projects with tasks derive progress from their completed-task ratio. Projects without tasks retain manual progress entry; deleting the last task resets progress to zero.

### Planner security and usage

- Only workspace owners and admins can read, generate, edit, cancel, or approve plans. Every action verifies authentication and project access, and PostgreSQL enforces permissions independently.
- `SARVAM_API_KEY` is a server-only environment variable. Keep `.env.local` private and use the placeholder `.env.example` in source control.
- The project name, description, brief, and preferences are sent to Sarvam AI during generation. Review the submitted content before using confidential project information.
- Prompts treat project text as untrusted data. Model output is schema-checked and graph-validated before it becomes a draft. Approval creates only tasks and dependency edges.
- The Responses API request sets `store: false`. Sarvam's data handling policies apply to submitted content.
- A PostgreSQL reservation limits each user to one generation in progress for two minutes and three attempts per rolling ten minutes across projects. Failed and cancelled attempts count toward this limit.
- AI effort estimates require human review. API charges depend on the model and account usage.

### Planner tests

`pnpm test` uses Node.js 24's test runner and a disposable PGlite PostgreSQL instance. Provider calls are mocked, so tests spend no API credits. The integration test covers brief → structured draft → edited approval → persisted task rows and dependency IDs, plus isolation, role checks, stale edits, failed imports, rate limits, cancellation, and idempotent retries.

## Pages

| Route | Page |
| --- | --- |
| `/login` | Sign in with email and password or with Google if enabled |
| `/signup` | Create an account |
| `/` | Protected dashboard with workspace totals, recent projects, upcoming tasks, and activity |
| `/workspaces` | Create and switch workspaces, view members, and manage invitations |
| `/projects` | Projects in the active workspace with status, progress, and deadlines |
| `/projects/new`, `/projects/[projectId]/edit` | Create, update, or delete projects as an owner or admin |
| `/projects/[projectId]/plan` | AI planner, saved drafts, review, and approval |
| `/my-tasks` | Filterable Kanban board, task details drawer, and comments |
| `/dependencies?project=<id>` | Interactive project dependency graph and delay impact |

The header account menu shows the signed-in profile and provides sign-out. Project counts and recent projects come from the active workspace. Progress follows completed tasks when a project has tasks. Task totals and upcoming assignments come from the active workspace.

## Verification

```powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Run `pnpm start` to serve a completed production build.

After applying the migrations in a disposable Supabase PostgreSQL database, run the rollback-only tests for [workspace isolation](supabase/tests/workspace_isolation.sql) and [task permissions and persistence](supabase/tests/task_management.sql), and [dependency validation and access](supabase/tests/task_dependencies.sql).

## Source layout

- `src/app` contains public auth routes, protected workspace routes, and the theme.
- `src/components` contains the auth forms, application shell, page sections, and shared shadcn/ui primitives.
- `src/lib/auth`, `src/lib/supabase`, and `src/proxy.ts` handle server-side authentication and session refresh.
- `src/lib/workspaces` contains workspace and project queries, server actions, and Zod validation.
- `src/lib/tasks` contains task queries, server actions, validation, and permission rules.
- `src/lib/planner` contains the planner schema, provider service, persistence, and actions.
- `src/lib/dependencies` contains deterministic graph algorithms, queries, and server actions.
- `tests/graph.test.mjs` exercises graph algorithms and invalid links through Node.js 24.
- `supabase` contains database migrations and isolation tests.
- `src/types` contains workspace and authentication types.
