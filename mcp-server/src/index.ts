import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const DAYBOOK_API_URL = process.env.DAYBOOK_API_URL ?? 'http://localhost:3000';
const DAYBOOK_API_KEY = process.env.DAYBOOK_API_KEY ?? '';
const PORT = parseInt(process.env.MCP_PORT ?? '3001', 10);

// ---------------------------------------------------------------------------
// Helper: authenticated fetch against the Daybook REST API
// ---------------------------------------------------------------------------
async function daybookFetch(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${DAYBOOK_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${DAYBOOK_API_KEY}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  // Some endpoints (e.g. CSV export) return plain text
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Build date helpers
// ---------------------------------------------------------------------------
function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: 'daybook-mcp',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tool: get_dashboard_summary
// ---------------------------------------------------------------------------
server.tool(
  'get_dashboard_summary',
  'Returns a markdown summary of pending todos and upcoming calendar events for the next 14 days.',
  {},
  async () => {
    const [todosData, eventsData] = await Promise.all([
      daybookFetch('/api/todos?status=pending'),
      daybookFetch(`/api/calendar?start=${todayISO()}&end=${plusDaysISO(14)}`),
    ]);

    const todos = (todosData as { data?: unknown[] })?.data ?? (todosData as unknown[]);
    const events = (eventsData as { data?: unknown[] })?.data ?? (eventsData as unknown[]);

    const todoCount = Array.isArray(todos) ? todos.length : 0;
    const eventCount = Array.isArray(events) ? events.length : 0;

    const eventLines = Array.isArray(events)
      ? (events as Array<{ title?: string; startAt?: string; allDay?: boolean }>)
          .slice(0, 10)
          .map((e) => {
            const when = e.allDay ? e.startAt?.split('T')[0] : e.startAt;
            return `- **${e.title ?? 'Untitled'}** — ${when ?? 'TBD'}`;
          })
          .join('\n')
      : '';

    const todoLines = Array.isArray(todos)
      ? (todos as Array<{ title?: string; priority?: string; dueDate?: string }>)
          .slice(0, 10)
          .map((t) => {
            const due = t.dueDate ? ` (due ${t.dueDate})` : '';
            const prio = t.priority ? ` [${t.priority}]` : '';
            return `- ${t.title ?? 'Untitled'}${prio}${due}`;
          })
          .join('\n')
      : '';

    const summary = [
      `# Daybook Dashboard — ${todayISO()}`,
      '',
      `## Pending Todos (${todoCount})`,
      todoLines || '_No pending todos_',
      '',
      `## Upcoming Events — next 14 days (${eventCount})`,
      eventLines || '_No upcoming events_',
    ].join('\n');

    return { content: [{ type: 'text', text: summary }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_todos
// ---------------------------------------------------------------------------
server.tool(
  'list_todos',
  'List todos, optionally filtered by status and/or categoryId.',
  {
    status: z.string().optional().describe("Filter by status, e.g. 'pending' or 'completed'"),
    categoryId: z.string().optional().describe('Filter by category ID'),
  },
  async ({ status, categoryId }) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (categoryId) params.set('categoryId', categoryId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await daybookFetch(`/api/todos${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: create_todo
// ---------------------------------------------------------------------------
server.tool(
  'create_todo',
  'Create a new todo item.',
  {
    title: z.string().describe('Title of the todo'),
    description: z.string().optional().describe('Optional description'),
    priority: z
      .enum(['low', 'medium', 'high'])
      .optional()
      .describe("Priority level: 'low', 'medium', or 'high'"),
    dueDate: z.string().optional().describe('Due date in ISO format (YYYY-MM-DD)'),
    categoryId: z.string().optional().describe('Category ID to assign'),
  },
  async ({ title, description, priority, dueDate, categoryId }) => {
    const body = { title, description, priority, dueDate, categoryId };
    const data = await daybookFetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: complete_todo
// ---------------------------------------------------------------------------
server.tool(
  'complete_todo',
  "Mark a todo as completed by its ID.",
  {
    id: z.string().describe('The todo ID to mark as completed'),
  },
  async ({ id }) => {
    const data = await daybookFetch(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: delete_todo
// ---------------------------------------------------------------------------
server.tool(
  'delete_todo',
  'Delete a todo by its ID.',
  {
    id: z.string().describe('The todo ID to delete'),
  },
  async ({ id }) => {
    const data = await daybookFetch(`/api/todos/${id}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_events
// ---------------------------------------------------------------------------
server.tool(
  'list_events',
  'List calendar events, optionally filtered by date range.',
  {
    start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ start, end }) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await daybookFetch(`/api/calendar${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: create_event
// ---------------------------------------------------------------------------
server.tool(
  'create_event',
  'Create a new calendar event.',
  {
    title: z.string().describe('Event title'),
    startAt: z.string().describe('Start datetime in ISO 8601 format'),
    endAt: z.string().describe('End datetime in ISO 8601 format'),
    description: z.string().optional().describe('Optional description'),
    allDay: z.boolean().optional().describe('Whether this is an all-day event'),
    rrule: z
      .string()
      .optional()
      .describe('Recurrence rule string (RFC 5545 RRULE)'),
  },
  async ({ title, startAt, endAt, description, allDay, rrule }) => {
    const body = { title, startAt, endAt, description, allDay, rrule };
    const data = await daybookFetch('/api/calendar', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_journal_entries
// ---------------------------------------------------------------------------
server.tool(
  'list_journal_entries',
  'List journal entries, optionally filtered by month.',
  {
    month: z
      .string()
      .optional()
      .describe("Month filter in YYYY-MM format, e.g. '2024-06'"),
  },
  async ({ month }) => {
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    const data = await daybookFetch(`/api/journal${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: create_journal_entry
// ---------------------------------------------------------------------------
server.tool(
  'create_journal_entry',
  'Create a new journal entry.',
  {
    content: z.string().describe('Body text of the journal entry'),
    title: z.string().optional().describe('Optional title'),
    mood: z
      .string()
      .optional()
      .describe("Mood label, e.g. 'happy', 'neutral', 'sad'"),
    tags: z.array(z.string()).optional().describe('Array of tag strings'),
    entryDate: z
      .string()
      .optional()
      .describe('Date of the entry (YYYY-MM-DD); defaults to today'),
  },
  async ({ content, title, mood, tags, entryDate }) => {
    const body = { content, title, mood, tags, entryDate };
    const data = await daybookFetch('/api/journal', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_transactions
// ---------------------------------------------------------------------------
server.tool(
  'list_transactions',
  'List financial transactions, optionally filtered by type and date range.',
  {
    type: z
      .enum(['income', 'expense'])
      .optional()
      .describe("Transaction type: 'income' or 'expense'"),
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ type, from, to }) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await daybookFetch(`/api/expenses${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: create_transaction
// ---------------------------------------------------------------------------
server.tool(
  'create_transaction',
  'Record a new financial transaction (income or expense).',
  {
    type: z.enum(['income', 'expense']).describe("Transaction type: 'income' or 'expense'"),
    amount: z.number().positive().describe('Amount as a positive number'),
    description: z.string().describe('Short description of the transaction'),
    date: z.string().describe('Transaction date (YYYY-MM-DD)'),
    categoryId: z.string().optional().describe('Optional category ID'),
    notes: z.string().optional().describe('Optional free-form notes'),
    merchant: z.string().optional().describe('Optional merchant or payee name'),
  },
  async ({ type, amount, description, date, categoryId, notes, merchant }) => {
    const body = { type, amount, description, date, categoryId, notes, merchant };
    const data = await daybookFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_pl_report
// ---------------------------------------------------------------------------
server.tool(
  'get_pl_report',
  'Get a profit & loss report for a date range, optionally grouped.',
  {
    from: z.string().describe('Start date (YYYY-MM-DD)'),
    to: z.string().describe('End date (YYYY-MM-DD)'),
    groupBy: z
      .enum(['day', 'week', 'month', 'category'])
      .optional()
      .describe("Group results by 'day', 'week', 'month', or 'category'"),
  },
  async ({ from, to, groupBy }) => {
    const params = new URLSearchParams({ from, to });
    if (groupBy) params.set('groupBy', groupBy);
    const data = await daybookFetch(`/api/expenses/reports?${params.toString()}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: export_transactions_csv
// ---------------------------------------------------------------------------
server.tool(
  'export_transactions_csv',
  'Export transactions as CSV text, optionally filtered by date range.',
  {
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ from, to }) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const csv = await daybookFetch(`/api/expenses/export${qs}`);
    return { content: [{ type: 'text', text: String(csv) }] };
  },
);

// ---------------------------------------------------------------------------
// HTTP server: one transport instance per request (stateless sessions)
// ---------------------------------------------------------------------------
const httpServer = createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'daybook-mcp' }));
    return;
  }

  // MCP endpoint
  if (req.url === '/mcp' || req.url === '/') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(PORT, () => {
  console.log(`Daybook MCP server listening on http://0.0.0.0:${PORT}`);
  console.log(`  MCP endpoint : http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health check : http://0.0.0.0:${PORT}/health`);
  console.log(`  API base URL : ${DAYBOOK_API_URL}`);
});
