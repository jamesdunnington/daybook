# Milestone planned items — design

Supersedes the "Milestone progress model" decision in
`2026-10-16-power-tab-design.md`. Everything else in that doc still stands.

## Why

The Activity Log was a free-form diary: progress only moved if the user
remembered to log work and link it to a milestone. The user's words:

> the activity log in power tab should have been set when we add new milestone
> and it should be added with target count then items will appear in activity
> log with a check box when check it becomes completed and the milestone gets
> updated so we can also add more targets into the milestone along the way or
> change the target date each activity should come with their own target
> completion date

So the milestone is now the plan, and the Activity Log is where its targets
live and get ticked off.

## Model

- **Targets are activity-log rows** linked to a milestone. A row with
  `completed_at = NULL` is planned; ticking sets `completed_at`, unticking
  clears it. Progress = sum of `count_value` of completed rows.
- **Invariant:** `target_count = completed progress + open (unticked) rows`.
  `src/lib/power-tab/items.ts` (`syncOpenSlots`, `recountMilestoneTarget`)
  maintains it.
- **Creating a milestone** (title, unit, target count, **required** completion
  date, optional names): the dialog starts with one optional name box; "Add
  target" adds a box and raises the count; a quantity field is a shortcut that
  keeps the box count in sync. Server creates one row per target; blank
  content is a valid, unnamed target.
- **Per-target date** (`target_date`) is optional. `NULL` = open, due with the
  milestone. Overdue = open and (`target_date` ?? milestone date) before today.
- **Changing the target count:** raising adds blank targets; lowering removes
  blank open ones only and refuses (400) rather than delete a named target.
  Adding a single target (`POST /log` with `planned: true`) raises the count by
  one; deleting an open target lowers it by one.
- **Milestone completion date is required** on create and cannot be cleared.
  Legacy milestones without one show a prompt to set it.
- **One-off work** with no milestone is still a one-line log entry, stored as
  already completed. A log with a `milestoneId` and the default count fills the
  milestone's next blank target instead of adding a row.
- **Abandoning a milestone** sets `status = 'abandoned'`: it and its targets
  are greyed out and sorted last, targets can't be edited/ticked, and it stops
  counting toward forecast, attention and project completion. Restoring sets it
  back to `active`.
- **Project completion is derived:** a project is `completed` when it has at
  least one non-abandoned milestone and all are at 100%; adding a milestone or
  target (or unticking) reopens it (`syncProjectStatus`, also run on
  `GET /milestones` to self-heal). Projects with no milestones keep the manual
  complete/reopen button.

## Migration

`drizzle/0004_planned_items.sql` adds `target_date` and `completed_at`, then
backfills `completed_at = entry_date` so existing entries stay completed and
current progress/forecasts don't change. Existing milestones get no blank
targets until the milestone is next saved from the edit dialog (which fills in
its remaining empty targets).

## Not covered / calls made

- Forecast and "needs attention" use `completed_at` as the activity date.
- A manual project "Mark complete" is overridden the next time a milestone or
  target changes, if its milestones disagree.
- No automated tests: the project has no test runner and no database in the dev
  environment. The migration and the blank-slot SQL were run against an
  in-memory Postgres; the route logic was typechecked and built only.
