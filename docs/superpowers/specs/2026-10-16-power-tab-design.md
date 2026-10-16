# Power Tab — design doc

## Intent

The user runs several niche content sites (expanding articles, running audits,
restructuring categories). Right now none of that work is timestamped
anywhere, so there's no way to look back and answer "when did I touch this
site, and how long did it take for Pinterest/Google to react?" Power Tab is a
per-project workspace that fixes that: a dated activity log as the core
feature, plus milestones (with a pace-based forecast) and flexible
Notion-style docs, all scoped to a project (one project per site). The AI
chat gets tools to read and write all of it, so logging work and asking for
a progress summary can both happen by just talking to the assistant.

## Goals

- A new "Power Tab" nav section containing a list of **Projects**.
- Each project has three parts:
  - **Activity Log** — append-only, dated entries ("expanded article X to
    2k words"). This is the most load-bearing feature; it must be fast to
    add to.
  - **Milestones** — a target count + unit (e.g. "50 articles") with an
    optional due date. Progress comes from activity-log entries linked to
    the milestone; the UI shows a forecast finish date calculated from
    recent pace, not a manually-updated progress bar.
  - **Pages** — a Notion-style page tree per project (multiple named
    sub-pages, nestable), using a real block editor: headings, checkboxes,
    tables, lists.
- Chat tools mirroring all of the above (list/create projects, log
  activity, create/check milestones, generate a project report/summary,
  read/write pages) — built the same way as the existing MCP-mirroring tool
  catalog in `src/lib/ai/tools.ts`.

## Non-goals

- No external integrations (no pulling real Pinterest/GSC analytics) —
  purely self-logged data.
- No multi-user/real-time collaboration.
- No deep Notion features — comments, mentions, linked databases/galleries.
  Core block types only: paragraph, headings, checklist, bullet/numbered
  list, table, divider.
- No automatic classification of what counts toward a milestone — the user
  (or the assistant, acting on their behalf) explicitly links a log entry
  to a milestone when logging it.

## Anti-goals (would make this a failure even if it "works")

- Logging a piece of work must be frictionless — a single line, dated,
  done. If adding a log entry feels like filling out a form, the feature
  doesn't get used and the whole point is lost.
- The forecast must never be presented with false precision. It's a linear
  extrapolation from a recent window of logged pace — show that
  assumption plainly ("based on the last 30 days") rather than just a bare
  date, and say "not enough data yet" when there's too little history
  instead of guessing.

## Constraints / conventions to follow

- Same Drizzle/Postgres schema conventions as the rest of the app (uuid
  PKs, userId scoping + cascade deletes, same auth helper pattern —
  `validateApiKey` then `requireSession`, as seen in every existing route).
- Chat tools follow the exact pattern already established in
  `src/lib/ai/tools.ts` / `src/lib/ai/internal-fetch.ts`: tool handlers call
  the project's own REST API via cookie-forwarded fetch, not duplicated
  business logic.
- Visual style follows the teal / Plus Jakarta Sans identity already
  applied app-wide (see prior commit `a86a68b`).
- Destructive actions (deleting a project, a page with children, a
  milestone) should follow the same "auto-execute + short undo window"
  policy already built for chat tool calls, where practical.

## Decisions made so far (not the builder's to re-litigate)

- **Structure**: Projects → Activity Log + Milestones + a page **tree**
  (multiple named, nestable sub-pages per project), not a single page per
  project.
- **Milestone progress model**: each activity-log entry can optionally
  carry `milestoneId` + `countValue` (default 1). A milestone's progress =
  sum of linked entries' `countValue`. Forecast = extrapolate from the sum
  of `countValue` logged in the last 30 days (rate per day) applied to the
  remaining distance to target.
- **Editor**: use **BlockNote** (open-source React library purpose-built to
  behave like Notion — slash menu, checkboxes, tables, drag handles) rather
  than building a block editor from scratch. Visual chrome (toolbars, slash
  menu) may not perfectly match the app's shadcn styling — treated as an
  accepted tradeoff for this first pass, not a blocker.
- **Chat access to page content**: the assistant reads/writes pages as
  plain text (extracted from the BlockNote JSON), not raw block JSON — a
  `read_project_page` tool returns plain text, and a
  `append_to_project_page` tool appends a paragraph/checklist item rather
  than doing full block-level editing through chat. Rich block editing
  (tables, nesting, drag-reorder) stays a UI-only action; chat's job is
  logging and summarizing, not laying out pages.
- **Reports**: "AI chat can generate report and analysis using Power Tab" —
  this means a `get_project_report` tool that assembles the activity log,
  milestone status/forecast, and page summaries into something the model
  can turn into a written summary on request; it does not mean a separate
  analytics dashboard UI in this first pass.

## Left to the builder

- Exact table/column names and the migration (follow the pattern used for
  `ai_undo_actions` in the prior commit; **double-check the generated
  migration against existing migrations before applying** — the last
  migration had a stale-snapshot bug that silently duplicated an
  already-shipped column; verify the new one doesn't do the same).
- Exact REST route paths under `/api/power-tab/...` (or similar), mirroring
  the existing `/api/todos`, `/api/calendar` structure.
- Exact BlockNote package choice (`@blocknote/core` + `@blocknote/react` +
  a styling package — check what's available before assuming a specific
  theme package name/version).
- Exact new tool names/JSON-schemas added to `src/lib/ai/tools.ts`.
- Nav icon and entry point (`src/components/layout/sidebar.tsx` +
  `mobile-nav.tsx`), and the Projects list / project detail page layout.
- A short manual test pass is not possible in the current dev environment
  (no Docker/Postgres running, no OpenRouter key) — same limitation noted
  for the chat feature; typecheck + production build are the available
  verification until the user tests it themselves.
