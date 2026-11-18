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

## Pages

| Route | Page |
| --- | --- |
| `/login` | Sign in with email and password or with Google if enabled |
| `/signup` | Create an account |
| `/` | Protected dashboard with workspace totals, recent projects, upcoming tasks, and activity |
| `/workspaces` | Create and switch workspaces, view members, and manage invitations |
| `/projects` | Projects in the active workspace with status, progress, and deadlines |
| `/projects/new`, `/projects/[projectId]/edit` | Create, update, or delete projects as an owner or admin |
| `/my-tasks` | Filterable Kanban board, task details drawer, and comments |
| `/dependencies?project=<id>` | Interactive project dependency graph and delay impact |

The header account menu shows the signed-in profile and provides sign-out. Project counts and recent projects come from the active workspace. Progress is entered in the project form. Task totals and upcoming assignments come from the active workspace.

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
- `src/lib/dependencies` contains deterministic graph algorithms, queries, and server actions.
- `tests/graph.test.mjs` exercises graph algorithms and invalid links through Node.js 24.
- `supabase` contains database migrations and isolation tests.
- `src/types` contains workspace and authentication types.
