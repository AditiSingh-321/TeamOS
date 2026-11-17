# TeamOS

TeamOS is a workspace for following projects, tasks, and team activity. Phase 1 uses a read-only sample workspace.

## Run locally

Use Node.js 24 and pnpm 11. From this directory, run:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open [TeamOS on localhost](http://localhost:3000).

## Pages

| Route | Page |
| --- | --- |
| `/` | Dashboard with workspace totals, recent projects, upcoming tasks, and activity |
| `/projects` | Project previews with status, progress, team members, and deadlines |
| `/my-tasks` | Tasks assigned to the demo user, ordered by due date |

The workspace uses a fixed sample date so the upcoming-task preview remains reproducible. Dashboard totals and project progress come from the task records.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

Run `pnpm start` to serve a completed production build.

## Source layout

- `src/app` contains App Router routes, the root layout, and theme tokens.
- `src/components` contains the application shell, page sections, and shared shadcn/ui primitives.
- `src/data/workspace.ts` contains the sample workspace, user, projects, tasks, and activity.
- `src/lib` contains date formatting, derived workspace data, and class composition.
- `src/types/workspace.ts` contains the domain types.
