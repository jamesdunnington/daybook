// Shared tool catalog for the in-app AI chat's tool-calling loop. Mirrors the tool set
// already exposed externally by mcp-server/src/index.ts (same names/params, so behavior
// stays identical across both surfaces), but calls the app's own REST API in-process via
// cookie-forwarded fetch instead of an external API key — see src/lib/ai/internal-fetch.ts.
//
// Policy (per product decision): every write auto-executes, no confirmation gate. Destructive
// (delete_*) and bulk (import_bank_statement_transactions) tools additionally snapshot enough
// state to support a short "Undo" window — see src/lib/ai/undo.ts.

import { db } from '@/lib/db';
import { todos, calendarEvents, journalEntries, expenseTransactions, expenseCategories, todoCategories } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { internalFetch, internalUpload } from '@/lib/ai/internal-fetch';
import { recordUndo } from '@/lib/ai/undo';
import { randomUUID } from 'crypto';

export interface ToolCtx {
  origin: string;
  cookieHeader: string;
  userId: string;
  conversationId: string | null;
  /** Images the user attached to the triggering chat message, keyed by uploadId. */
  pendingUploads: Map<string, { buffer: Buffer; mimeType: string; filename: string }>;
}

export interface ToolRunResult {
  output: unknown;
  summary: string;
  undoId?: string;
  undoExpiresAt?: string;
}

type ToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type Handler = (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolRunResult>;

const specs: ToolSpec[] = [];
const handlers = new Map<string, Handler>();

function define(
  name: string,
  description: string,
  parameters: { properties: Record<string, unknown>; required?: string[] },
  handler: Handler
) {
  specs.push({
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: parameters.properties,
        required: parameters.required ?? [],
      },
    },
  });
  handlers.set(name, handler);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function snapshotRow(table: any, id: string, userId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .limit(1);
  return row ?? null;
}

// ─── Todos ──────────────────────────────────────────────────────────────────

define(
  'list_todos',
  'List todos, optionally filtered by status and/or categoryId.',
  { properties: { status: { type: 'string' }, categoryId: { type: 'string' } } },
  async (args, ctx) => {
    const params = new URLSearchParams();
    if (args.status) params.set('status', String(args.status));
    if (args.categoryId) params.set('categoryId', String(args.categoryId));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/todos${qs}`);
    return { output, summary: 'Listed todos' };
  }
);

define(
  'create_todo',
  'Create a new todo item.',
  {
    properties: {
      title: { type: 'string', description: 'Title of the todo' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string', description: 'YYYY-MM-DD' },
      categoryId: { type: 'string' },
    },
    required: ['title'],
  },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/todos', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    const title = (output as { title?: string })?.title ?? String(args.title);
    return { output, summary: `Added todo "${title}"` };
  }
);

define(
  'update_todo',
  'Update an existing todo item by ID. Only provided fields are changed.',
  {
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'completed'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string' },
      categoryId: { type: 'string' },
    },
    required: ['id'],
  },
  async (args, ctx) => {
    const { id, ...body } = args;
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { output, summary: `Updated todo` };
  }
);

define(
  'complete_todo',
  'Mark a todo as completed by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/todos/${args.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    return { output, summary: 'Marked todo complete' };
  }
);

define(
  'delete_todo',
  'Delete a todo by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(todos, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/todos/${id}`, { method: 'DELETE' });
    const summary = `Deleted todo "${snapshot?.title ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_todo',
      summary,
      undoData: { kind: 'restore_row', table: 'todos', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

define(
  'list_todo_categories',
  'List all todo categories.',
  { properties: {} },
  async (_args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, '/api/todos/categories'),
    summary: 'Listed todo categories',
  })
);

define(
  'create_todo_category',
  'Create a new todo category.',
  { properties: { name: { type: 'string' }, color: { type: 'string' } }, required: ['name'] },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/todos/categories', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: `Created todo category "${args.name}"` };
  }
);

define(
  'delete_todo_category',
  'Delete a todo category by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(todoCategories, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/todos/categories/${id}`, { method: 'DELETE' });
    const summary = `Deleted todo category "${snapshot?.name ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_todo_category',
      summary,
      undoData: { kind: 'restore_row', table: 'todoCategories', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

// ─── Calendar ───────────────────────────────────────────────────────────────

define(
  'list_events',
  'List calendar events, optionally filtered by date range.',
  { properties: { start: { type: 'string' }, end: { type: 'string' } } },
  async (args, ctx) => {
    const params = new URLSearchParams();
    if (args.start) params.set('start', String(args.start));
    if (args.end) params.set('end', String(args.end));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return { output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/calendar${qs}`), summary: 'Listed events' };
  }
);

define(
  'create_event',
  'Create a new calendar event.',
  {
    properties: {
      title: { type: 'string' },
      startAt: { type: 'string', description: 'ISO 8601 datetime' },
      endAt: { type: 'string', description: 'ISO 8601 datetime' },
      description: { type: 'string' },
      allDay: { type: 'boolean' },
      rrule: { type: 'string' },
    },
    required: ['title', 'startAt', 'endAt'],
  },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/calendar', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: `Added event "${args.title}"` };
  }
);

define(
  'update_event',
  'Update an existing calendar event by ID. Only provided fields are changed.',
  {
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      startAt: { type: 'string' },
      endAt: { type: 'string' },
      allDay: { type: 'boolean' },
      location: { type: 'string' },
      color: { type: 'string' },
      rrule: { type: 'string' },
    },
    required: ['id'],
  },
  async (args, ctx) => {
    const { id, ...body } = args;
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/calendar/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { output, summary: 'Updated event' };
  }
);

define(
  'delete_event',
  'Delete a calendar event by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(calendarEvents, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/calendar/${id}`, { method: 'DELETE' });
    const summary = `Deleted event "${snapshot?.title ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_event',
      summary,
      undoData: { kind: 'restore_row', table: 'calendarEvents', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

// ─── Journal ────────────────────────────────────────────────────────────────

define(
  'list_journal_entries',
  'List journal entries, optionally filtered by month.',
  { properties: { month: { type: 'string', description: 'YYYY-MM' } } },
  async (args, ctx) => {
    const qs = args.month ? `?month=${encodeURIComponent(String(args.month))}` : '';
    return { output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/journal${qs}`), summary: 'Listed journal entries' };
  }
);

define(
  'create_journal_entry',
  'Create a new journal entry.',
  {
    properties: {
      content: { type: 'string' },
      title: { type: 'string' },
      mood: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      entryDate: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
    },
    required: ['content'],
  },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/journal', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: 'Added journal entry' };
  }
);

define(
  'update_journal_entry',
  'Update an existing journal entry by ID. Only provided fields are changed.',
  {
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      mood: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
  },
  async (args, ctx) => {
    const { id, ...body } = args;
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/journal/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { output, summary: 'Updated journal entry' };
  }
);

define(
  'delete_journal_entry',
  'Delete a journal entry and all its attached photos by ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(journalEntries, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/journal/${id}`, { method: 'DELETE' });
    const summary = `Deleted journal entry "${snapshot?.title ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_journal_entry',
      summary,
      undoData: { kind: 'restore_row', table: 'journalEntries', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

define(
  'attach_photo_to_journal_entry',
  'Attach a photo the user just sent in this chat message to a journal entry.',
  {
    properties: {
      entryId: { type: 'string' },
      uploadId: { type: 'string', description: 'The uploadId of an image attached to the current chat message' },
    },
    required: ['entryId', 'uploadId'],
  },
  async (args, ctx) => {
    const upload = ctx.pendingUploads.get(String(args.uploadId));
    if (!upload) throw new Error(`No attached image with uploadId ${args.uploadId} on this message`);
    const form = new FormData();
    form.append('photos', new Blob([new Uint8Array(upload.buffer)], { type: upload.mimeType }), upload.filename);
    const output = await internalUpload(ctx.origin, ctx.cookieHeader, `/api/journal/${args.entryId}/photos`, form);
    return { output, summary: 'Attached photo to journal entry' };
  }
);

// ─── Expenses ───────────────────────────────────────────────────────────────

define(
  'list_transactions',
  'List financial transactions, optionally filtered by type and date range.',
  {
    properties: {
      type: { type: 'string', enum: ['income', 'expense'] },
      from: { type: 'string' },
      to: { type: 'string' },
    },
  },
  async (args, ctx) => {
    const params = new URLSearchParams();
    if (args.type) params.set('type', String(args.type));
    if (args.from) params.set('from', String(args.from));
    if (args.to) params.set('to', String(args.to));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return { output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses${qs}`), summary: 'Listed transactions' };
  }
);

define(
  'create_transaction',
  'Record a new financial transaction (income or expense).',
  {
    properties: {
      type: { type: 'string', enum: ['income', 'expense'] },
      amount: { type: 'number' },
      description: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      categoryId: { type: 'string' },
      notes: { type: 'string' },
      merchant: { type: 'string' },
    },
    required: ['type', 'amount', 'description', 'date'],
  },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/expenses', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: `Recorded ${args.type} of ${args.amount} ("${args.description}")` };
  }
);

define(
  'update_transaction',
  'Update an existing financial transaction by ID.',
  {
    properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['income', 'expense'] },
      amount: { type: 'number' },
      description: { type: 'string' },
      date: { type: 'string' },
      categoryId: { type: 'string' },
      notes: { type: 'string' },
      merchant: { type: 'string' },
    },
    required: ['id'],
  },
  async (args, ctx) => {
    const { id, ...body } = args;
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { output, summary: 'Updated transaction' };
  }
);

define(
  'delete_transaction',
  'Delete a financial transaction by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(expenseTransactions, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses/${id}`, { method: 'DELETE' });
    const summary = `Deleted transaction "${snapshot?.description ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_transaction',
      summary,
      undoData: { kind: 'restore_row', table: 'expenseTransactions', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

define(
  'list_expense_categories',
  'List all expense and income categories.',
  { properties: {} },
  async (_args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, '/api/expenses/categories'),
    summary: 'Listed expense categories',
  })
);

define(
  'create_expense_category',
  'Create a new expense or income category.',
  {
    properties: { name: { type: 'string' }, type: { type: 'string', enum: ['expense', 'income'] }, color: { type: 'string' } },
    required: ['name', 'type'],
  },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/expenses/categories', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: `Created category "${args.name}"` };
  }
);

define(
  'delete_expense_category',
  'Delete an expense/income category by its ID.',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const id = String(args.id);
    const snapshot = await snapshotRow(expenseCategories, id, ctx.userId);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses/categories/${id}`, { method: 'DELETE' });
    const summary = `Deleted category "${snapshot?.name ?? id}"`;
    if (!snapshot) return { output, summary };
    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'delete_expense_category',
      summary,
      undoData: { kind: 'restore_row', table: 'expenseCategories', row: snapshot },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

define(
  'get_pl_report',
  'Get a profit & loss report for a date range, optionally grouped.',
  {
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      groupBy: { type: 'string', enum: ['day', 'week', 'month', 'category'] },
    },
    required: ['from', 'to'],
  },
  async (args, ctx) => {
    const params = new URLSearchParams({ from: String(args.from), to: String(args.to) });
    if (args.groupBy) params.set('groupBy', String(args.groupBy));
    return { output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses/reports?${params}`), summary: 'Fetched P&L report' };
  }
);

define(
  'export_transactions_csv',
  'Export transactions as CSV text, optionally filtered by date range.',
  { properties: { from: { type: 'string' }, to: { type: 'string' } } },
  async (args, ctx) => {
    const params = new URLSearchParams();
    if (args.from) params.set('from', String(args.from));
    if (args.to) params.set('to', String(args.to));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return { output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/expenses/export${qs}`), summary: 'Exported transactions CSV' };
  }
);

define(
  'attach_photo_to_transaction',
  'Attach or replace the receipt image for a financial transaction, using a photo the user just sent in this chat message.',
  {
    properties: {
      transactionId: { type: 'string' },
      uploadId: { type: 'string', description: 'The uploadId of an image attached to the current chat message' },
    },
    required: ['transactionId', 'uploadId'],
  },
  async (args, ctx) => {
    const upload = ctx.pendingUploads.get(String(args.uploadId));
    if (!upload) throw new Error(`No attached image with uploadId ${args.uploadId} on this message`);
    const form = new FormData();
    form.append('receipt', new Blob([new Uint8Array(upload.buffer)], { type: upload.mimeType }), upload.filename);
    const output = await internalUpload(ctx.origin, ctx.cookieHeader, `/api/expenses/${args.transactionId}/receipt`, form);
    return { output, summary: 'Attached receipt photo to transaction' };
  }
);

define(
  'import_bank_statement_transactions',
  "Bulk-record transactions the model read directly from a bank statement photo the user attached to this " +
  'chat message. Extract every line item yourself from the image (you can see it) and pass them here as ' +
  'structured rows — do not describe the image, call this with the actual data.',
  {
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            type: { type: 'string', enum: ['income', 'expense'] },
            amount: { type: 'number' },
            description: { type: 'string' },
            merchant: { type: 'string' },
          },
          required: ['date', 'type', 'amount', 'description'],
        },
      },
    },
    required: ['transactions'],
  },
  async (args, ctx) => {
    const rows = args.transactions as Array<{
      date: string;
      type: 'income' | 'expense';
      amount: number;
      description: string;
      merchant?: string;
    }>;
    if (!rows?.length) throw new Error('transactions must be a non-empty array');
    const importBatchId = randomUUID();

    if (!ctx.conversationId) throw new Error('No active conversation to import into');
    const output = await internalFetch(
      ctx.origin,
      ctx.cookieHeader,
      `/api/chat/${ctx.conversationId}/confirm-import`,
      {
        method: 'POST',
        body: JSON.stringify({ importBatchId, transactions: rows }),
      }
    );

    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const summary = `Imported ${rows.length} transactions from statement photo (income $${income.toFixed(2)}, expense $${expense.toFixed(2)})`;

    const undo = await recordUndo({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'import_bank_statement_transactions',
      summary,
      undoData: { kind: 'delete_rows_by_batch', importBatchId },
    });
    return { output, summary, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() };
  }
);

// ─── Dashboard ──────────────────────────────────────────────────────────────

define(
  'get_dashboard_summary',
  'Get a summary of pending todos and upcoming calendar events for the next 14 days.',
  { properties: {} },
  async (_args, ctx) => {
    const today = new Date().toISOString().split('T')[0];
    const in14 = new Date(Date.now() + 14 * 86400_000).toISOString().split('T')[0];
    const [todosData, eventsData] = await Promise.all([
      internalFetch(ctx.origin, ctx.cookieHeader, '/api/todos?status=pending'),
      internalFetch(ctx.origin, ctx.cookieHeader, `/api/calendar?start=${today}&end=${in14}`),
    ]);
    return { output: { todos: todosData, events: eventsData }, summary: 'Fetched dashboard summary' };
  }
);

// ─── Power Tab (projects) ───────────────────────────────────────────────────

// Flattens a BlockNote document (array of blocks, each possibly with nested
// `children`) into plain text — chat reads/writes pages as text, never raw
// block JSON (see design doc: docs/superpowers/specs/2026-10-16-power-tab-design.md).
function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const lines: string[] = [];
  const visit = (block: Record<string, unknown>, depth: number) => {
    const content = Array.isArray(block.content) ? block.content : [];
    const text = content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('');
    const prefix = block.type === 'checkListItem' ? (block.props as { checked?: boolean } | undefined)?.checked ? '[x] ' : '[ ] ' : '';
    if (text.trim() || prefix) lines.push('  '.repeat(depth) + prefix + text);
    if (Array.isArray(block.children)) {
      for (const child of block.children) visit(child as Record<string, unknown>, depth + 1);
    }
  };
  for (const block of blocks) visit(block as Record<string, unknown>, 0);
  return lines.join('\n');
}

// Splits a line into BlockNote inline runs, honouring **bold** and `code`.
function inlineRuns(text: string) {
  const runs: { type: 'text'; text: string; styles: Record<string, boolean> }[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ type: 'text', text: text.slice(last, m.index), styles: {} });
    runs.push(m[1] !== undefined
      ? { type: 'text', text: m[1], styles: { bold: true } }
      : { type: 'text', text: m[2], styles: { code: true } });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ type: 'text', text: text.slice(last), styles: {} });
  return runs;
}

function makeBlock(type: string, text: string, extraProps: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type,
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left', ...extraProps },
    content: inlineRuns(text),
    children: [],
  };
}

// Converts markdown-ish text (headings, bullets, numbered lists, checklists,
// paragraphs) into real BlockNote blocks so pages render formatted in the editor
// instead of showing raw `#` / `-` / `1.` symbols in one paragraph.
function textToBlocks(text: string) {
  const blocks: ReturnType<typeof makeBlock>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      blocks.push(makeBlock('heading', m[2], { level: Math.min(m[1].length, 3) }));
    } else if ((m = line.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/))) {
      blocks.push(makeBlock('checkListItem', m[2], { checked: m[1] !== ' ' }));
    } else if ((m = line.match(/^[-*+•]\s+(.*)$/))) {
      blocks.push(makeBlock('bulletListItem', m[1]));
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      blocks.push(makeBlock('numberedListItem', m[1]));
    } else {
      blocks.push(makeBlock('paragraph', line));
    }
  }
  return blocks;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// Models sometimes pass a project name or slug ("new_horizon_tab") instead of the
// UUID, which the DB rejects. Accept a UUID as-is; otherwise match by name/slug.
async function resolveProjectId(ref: unknown, ctx: { origin: string; cookieHeader: string }): Promise<string> {
  const value = String(ref ?? '').trim();
  if (UUID_RE.test(value)) return value;
  const projects = (await internalFetch(ctx.origin, ctx.cookieHeader, '/api/power-tab/projects')) as {
    id: string;
    name: string;
  }[];
  const key = slugify(value);
  const match = projects.find((p) => slugify(p.name) === key);
  if (!match) {
    throw new Error(
      `No project matches "${value}". Call list_projects and pass the project's "id" (a UUID), not its name.`
    );
  }
  return match.id;
}

define(
  'list_projects',
  'List all Power Tab projects.',
  { properties: {} },
  async (_args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, '/api/power-tab/projects'),
    summary: 'Listed projects',
  })
);

define(
  'create_project',
  'Create a new Power Tab project (e.g. one per website you manage).',
  { properties: { name: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' } }, required: ['name'] },
  async (args, ctx) => {
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, '/api/power-tab/projects', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    return { output, summary: `Created project "${args.name}"` };
  }
);

define(
  'log_project_activity',
  'Add a dated activity-log entry to a project — use this whenever the user mentions doing work on a project ' +
  '(e.g. "expanded article X", "ran an audit"). Optionally link it to a milestone with a count so progress tracks it.',
  {
    properties: {
      projectId: { type: 'string' },
      content: { type: 'string', description: 'What was done' },
      entryDate: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
      milestoneId: { type: 'string', description: 'Optional milestone this counts toward' },
      countValue: { type: 'number', description: 'How much this entry counts toward the milestone (default 1)' },
    },
    required: ['projectId', 'content'],
  },
  async (args, ctx) => {
    const { projectId: projectRef, ...body } = args;
    const projectId = await resolveProjectId(projectRef, ctx);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/log`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { output, summary: `Logged activity: "${args.content}"` };
  }
);

define(
  'list_project_activity',
  'List the dated activity-log entries for a project.',
  { properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  async (args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${await resolveProjectId(args.projectId, ctx)}/log`),
    summary: 'Listed project activity',
  })
);

define(
  'create_milestone',
  'Create a milestone for a project — a target count (e.g. 50 articles) with an optional due date. Progress and ' +
  'a pace-based forecast are computed automatically from linked activity-log entries.',
  {
    properties: {
      projectId: { type: 'string' },
      title: { type: 'string' },
      unitLabel: { type: 'string', description: "e.g. 'articles'" },
      targetCount: { type: 'number' },
      targetDate: { type: 'string', description: 'Optional YYYY-MM-DD' },
    },
    required: ['projectId', 'title', 'targetCount'],
  },
  async (args, ctx) => {
    const { projectId: projectRef, ...body } = args;
    const projectId = await resolveProjectId(projectRef, ctx);
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/milestones`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { output, summary: `Created milestone "${args.title}"` };
  }
);

define(
  'list_project_milestones',
  'List milestones for a project, each with computed progress and a pace-based forecast finish date.',
  { properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  async (args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${await resolveProjectId(args.projectId, ctx)}/milestones`),
    summary: 'Listed milestones',
  })
);

define(
  'list_project_pages',
  "List a project's page tree (titles and IDs only).",
  { properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  async (args, ctx) => ({
    output: await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${await resolveProjectId(args.projectId, ctx)}/pages`),
    summary: 'Listed project pages',
  })
);

define(
  'read_project_page',
  'Read a project page as plain text (not raw block data).',
  { properties: { pageId: { type: 'string' } }, required: ['pageId'] },
  async (args, ctx) => {
    const page = (await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/pages/${args.pageId}`)) as {
      title: string;
      content: unknown;
    };
    return { output: { title: page.title, text: blocksToText(page.content) }, summary: `Read page "${page.title}"` };
  }
);

define(
  'create_project_page',
  'Create a new page in a project (optionally nested under a parent page).',
  {
    properties: {
      projectId: { type: 'string' },
      title: { type: 'string' },
      parentId: { type: 'string', description: 'Optional parent page ID to nest under' },
      initialText: {
        type: 'string',
        description:
          'Optional page body. Markdown is converted to real formatting: "# Heading" (1-3 #), "- item" bullets, "1. item" numbered lists, "- [ ] task" checklists, **bold**, `code`. One block per line; blank lines are skipped.',
      },
    },
    required: ['projectId', 'title'],
  },
  async (args, ctx) => {
    const projectId = await resolveProjectId(args.projectId, ctx);
    const body = {
      title: args.title,
      parentId: args.parentId ?? null,
      content: args.initialText ? textToBlocks(String(args.initialText)) : [],
    };
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/pages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { output, summary: `Created page "${args.title}"` };
  }
);

define(
  'append_to_project_page',
  'Append content to an existing project page. Markdown is converted to real formatting: "# Heading" (1-3 #), "- item" bullets, "1. item" numbered lists, "- [ ] task" checklists, **bold**, `code`. One block per line.',
  { properties: { pageId: { type: 'string' }, text: { type: 'string' } }, required: ['pageId', 'text'] },
  async (args, ctx) => {
    const page = (await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/pages/${args.pageId}`)) as {
      content: unknown[];
    };
    const content = [...(Array.isArray(page.content) ? page.content : []), ...textToBlocks(String(args.text))];
    const output = await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/pages/${args.pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    return { output, summary: 'Appended text to page' };
  }
);

define(
  'get_project_report',
  'Assemble a full report for a project — recent activity, milestone progress/forecasts, and page summaries — ' +
  'for you to turn into a written analysis when the user asks how a project is going.',
  { properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  async (args, ctx) => {
    const projectId = await resolveProjectId(args.projectId, ctx);
    const [project, log, milestones, pages] = await Promise.all([
      internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}`),
      internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/log`),
      internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/milestones`),
      internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${projectId}/pages`),
    ]);
    return {
      output: { project, recentActivity: (log as unknown[]).slice(0, 30), milestones, pages },
      summary: 'Assembled project report',
    };
  }
);

define(
  'delete_project',
  'Delete a Power Tab project and everything in it (pages, log, milestones).',
  { properties: { id: { type: 'string' } }, required: ['id'] },
  async (args, ctx) => {
    const result = (await internalFetch(ctx.origin, ctx.cookieHeader, `/api/power-tab/projects/${args.id}`, {
      method: 'DELETE',
    })) as { undoId?: string; undoExpiresAt?: string };
    return { output: result, summary: 'Deleted project', undoId: result.undoId, undoExpiresAt: result.undoExpiresAt };
  }
);

// ─── Exports ────────────────────────────────────────────────────────────────

export const TOOL_SPECS: ToolSpec[] = specs;

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolRunResult> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args, ctx);
}
