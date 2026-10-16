// Records and reverts "undo windows" for destructive (delete_*) and bulk (statement
// import) tool actions, per the product decision: writes auto-execute with no
// confirmation gate, but destructive/bulk ones stay revertible for a short window.

import { db } from '@/lib/db';
import { aiUndoActions, todos, calendarEvents, journalEntries, expenseTransactions, expenseCategories, todoCategories, projects, projectMilestones, projectPages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { AiUndoAction } from '@/lib/db/schema';

const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

type UndoData = AiUndoAction['undoData'];

export async function recordUndo(params: {
  userId: string;
  conversationId: string | null;
  toolName: string;
  summary: string;
  undoData: UndoData;
}): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + UNDO_WINDOW_MS);
  const [row] = await db
    .insert(aiUndoActions)
    .values({
      userId: params.userId,
      conversationId: params.conversationId,
      toolName: params.toolName,
      summary: params.summary,
      undoData: params.undoData,
      expiresAt,
    })
    .returning({ id: aiUndoActions.id });
  return { id: row.id, expiresAt };
}

const TABLES = {
  todos,
  calendarEvents,
  journalEntries,
  expenseTransactions,
  expenseCategories,
  todoCategories,
  projects,
  projectMilestones,
  projectPages,
} as const;

export async function applyUndo(id: string, userId: string): Promise<{ summary: string }> {
  const row = await db.query.aiUndoActions.findFirst({
    where: and(eq(aiUndoActions.id, id), eq(aiUndoActions.userId, userId)),
  });
  if (!row) throw new Error('Undo action not found');
  if (row.undoneAt) throw new Error('Already undone');
  if (row.expiresAt.getTime() < Date.now()) throw new Error('Undo window has expired');

  const data = row.undoData;

  if (data.kind === 'restore_row') {
    const table = TABLES[data.table];
    await db.insert(table).values(data.row as never);
  } else if (data.kind === 'delete_rows_by_batch') {
    await db
      .delete(expenseTransactions)
      .where(
        and(
          eq(expenseTransactions.importBatchId, data.importBatchId),
          eq(expenseTransactions.userId, userId)
        )
      );
  }

  await db.update(aiUndoActions).set({ undoneAt: new Date() }).where(eq(aiUndoActions.id, id));
  return { summary: `Undone: ${row.summary}` };
}
