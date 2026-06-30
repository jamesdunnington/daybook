import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const DAYBOOK_API_URL = process.env.DAYBOOK_API_URL ?? 'http://localhost:3000';
const DAYBOOK_API_KEY = process.env.DAYBOOK_API_KEY ?? '';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3001';
const MCP_AUTH_TOKEN = process.env.DAYBOOK_API_KEY ?? '';
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const AUTH_STORE_PATH = process.env.MCP_DATA_DIR
  ? `${process.env.MCP_DATA_DIR}/auth-store.json`
  : '/app/data/auth-store.json';

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
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Helper: wrap tool handlers so errors surface as readable MCP responses
// ---------------------------------------------------------------------------
type ToolContent = { type: 'text'; text: string };
type ToolResult = { content: ToolContent[]; isError?: true };

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
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
// HTML escape helper
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// OAuth authorization form
// ---------------------------------------------------------------------------
function renderAuthForm(
  client: { client_id: string; client_name?: string },
  params: { redirectUri: string; codeChallenge: string; state?: string; scopes?: string[]; resource?: URL },
  error?: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daybook — Authorize</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:40px 16px}
    .card{background:#fff;border:1px solid #e0e0e0;border-radius:10px;max-width:400px;margin:0 auto;padding:32px}
    h1{font-size:1.4rem;margin:0 0 4px}
    .sub{color:#666;font-size:0.9rem;margin:0 0 20px}
    .err{color:#c00;font-size:0.875rem;margin-bottom:14px;padding:8px 12px;background:#fff0f0;border-radius:6px}
    label{display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px}
    input[type=password]{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:1rem}
    input[type=password]:focus{outline:none;border-color:#333}
    button{margin-top:14px;width:100%;padding:11px;background:#111;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer}
    button:hover{background:#333}
  </style>
</head>
<body>
  <div class="card">
    <h1>Daybook</h1>
    <p class="sub"><strong>${esc(client.client_name ?? 'An application')}</strong> wants to connect to your Daybook.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="POST">
      <input type="hidden" name="client_id" value="${esc(client.client_id)}" />
      <input type="hidden" name="redirect_uri" value="${esc(params.redirectUri)}" />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="code_challenge" value="${esc(params.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      ${params.state ? `<input type="hidden" name="state" value="${esc(params.state)}" />` : ''}
      ${params.scopes?.length ? `<input type="hidden" name="scope" value="${esc(params.scopes.join(' '))}" />` : ''}
      ${params.resource ? `<input type="hidden" name="resource" value="${esc(params.resource.toString())}" />` : ''}
      <label for="mcp_key">Daybook API Key</label>
      <input type="password" id="mcp_key" name="mcp_key" placeholder="Enter your DAYBOOK_MCP_KEY" autofocus />
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Persistent OAuth provider — survives container restarts via JSON file
// ---------------------------------------------------------------------------
type ClientMeta = { client_id: string; client_name?: string; redirect_uris: string[] };
type CodeData = { client: ClientMeta; params: { redirectUri: string; codeChallenge: string; state?: string; scopes?: string[]; resource?: URL } };
type TokenData = { clientId: string; scopes: string[]; expiresAt: number; resource?: string };

interface AuthStore {
  clients: Record<string, ClientMeta>;
  tokens: Record<string, TokenData>;
}

function loadStore(): AuthStore {
  try {
    const raw = readFileSync(AUTH_STORE_PATH, 'utf8');
    return JSON.parse(raw) as AuthStore;
  } catch {
    return { clients: {}, tokens: {} };
  }
}

function saveStore(store: AuthStore): void {
  try {
    mkdirSync(dirname(AUTH_STORE_PATH), { recursive: true });
    writeFileSync(AUTH_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist auth store:', err);
  }
}

class DaybookAuthProvider {
  private store: AuthStore = loadStore();
  private codes = new Map<string, CodeData>();

  clientsStore = {
    getClient: async (clientId: string): Promise<ClientMeta | undefined> => {
      return this.store.clients[clientId];
    },
    registerClient: async (metadata: ClientMeta): Promise<ClientMeta> => {
      this.store.clients[metadata.client_id] = metadata;
      saveStore(this.store);
      return metadata;
    },
  };

  async authorize(
    client: ClientMeta,
    params: { redirectUri: string; codeChallenge: string; state?: string; scopes?: string[]; resource?: URL },
    res: express.Response,
  ): Promise<void> {
    const req = res.req as express.Request;

    if (req.method === 'POST' && typeof req.body?.mcp_key === 'string') {
      if (!MCP_AUTH_TOKEN || req.body.mcp_key !== MCP_AUTH_TOKEN) {
        res.send(renderAuthForm(client, params, 'Invalid API key. Please try again.'));
        return;
      }
      const code = randomUUID();
      this.codes.set(code, { client, params });
      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set('code', code);
      if (params.state) redirectUrl.searchParams.set('state', params.state);
      res.redirect(redirectUrl.toString());
    } else {
      res.send(renderAuthForm(client, params));
    }
  }

  async challengeForAuthorizationCode(_client: ClientMeta, authorizationCode: string): Promise<string> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error('Invalid authorization code');
    return data.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: ClientMeta,
    authorizationCode: string,
  ): Promise<{ access_token: string; token_type: string; expires_in: number; scope: string }> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error('Invalid authorization code');
    if (data.client.client_id !== client.client_id) throw new Error('Client mismatch');
    this.codes.delete(authorizationCode);

    const token = randomUUID();
    this.store.tokens[token] = {
      clientId: client.client_id,
      scopes: data.params.scopes ?? [],
      expiresAt: Date.now() + 30 * 24 * 3600 * 1000, // 30 days
      resource: data.params.resource?.toString(),
    };
    saveStore(this.store);

    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 30 * 86400,
      scope: (data.params.scopes ?? []).join(' '),
    };
  }

  async exchangeRefreshToken(): Promise<never> {
    throw new Error('Refresh tokens are not supported');
  }

  async verifyAccessToken(token: string): Promise<{ token: string; clientId: string; scopes: string[]; expiresAt: number; resource?: URL }> {
    // Prune expired tokens lazily
    const now = Date.now();
    const data = this.store.tokens[token];
    if (!data || data.expiresAt < now) {
      if (data) {
        delete this.store.tokens[token];
        saveStore(this.store);
      }
      throw new Error('Invalid or expired token');
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource ? new URL(data.resource) : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------
const mcpServer = new McpServer({ name: 'daybook-mcp', version: '1.0.0' });

// ---------------------------------------------------------------------------
// Tool: get_dashboard_summary
// ---------------------------------------------------------------------------
mcpServer.tool(
  'get_dashboard_summary',
  'Returns a markdown summary of pending todos and upcoming calendar events for the next 14 days.',
  {},
  async () => runTool(async () => {
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

    return summary;
  }),
);

// ---------------------------------------------------------------------------
// Tool: list_todos
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_todos',
  'List todos, optionally filtered by status and/or categoryId.',
  {
    status: z.string().optional().describe("Filter by status, e.g. 'pending' or 'completed'"),
    categoryId: z.string().optional().describe('Filter by category ID'),
  },
  async ({ status, categoryId }) => runTool(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (categoryId) params.set('categoryId', categoryId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return daybookFetch(`/api/todos${qs}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: create_todo
// ---------------------------------------------------------------------------
mcpServer.tool(
  'create_todo',
  'Create a new todo item.',
  {
    title: z.string().describe('Title of the todo'),
    description: z.string().optional().describe('Optional description'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe("Priority level: 'low', 'medium', or 'high'"),
    dueDate: z.string().optional().describe('Due date in ISO format (YYYY-MM-DD)'),
    categoryId: z.string().optional().describe('Category ID to assign'),
  },
  async ({ title, description, priority, dueDate, categoryId }) => runTool(() =>
    daybookFetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title, description, priority, dueDate, categoryId }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: complete_todo
// ---------------------------------------------------------------------------
mcpServer.tool(
  'complete_todo',
  'Mark a todo as completed by its ID.',
  { id: z.string().describe('The todo ID to mark as completed') },
  async ({ id }) => runTool(() =>
    daybookFetch(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: delete_todo
// ---------------------------------------------------------------------------
mcpServer.tool(
  'delete_todo',
  'Delete a todo by its ID.',
  { id: z.string().describe('The todo ID to delete') },
  async ({ id }) => runTool(() => daybookFetch(`/api/todos/${id}`, { method: 'DELETE' })),
);

// ---------------------------------------------------------------------------
// Tool: list_events
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_events',
  'List calendar events, optionally filtered by date range.',
  {
    start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ start, end }) => runTool(async () => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return daybookFetch(`/api/calendar${qs}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: create_event
// ---------------------------------------------------------------------------
mcpServer.tool(
  'create_event',
  'Create a new calendar event.',
  {
    title: z.string().describe('Event title'),
    startAt: z.string().describe('Start datetime in ISO 8601 format'),
    endAt: z.string().describe('End datetime in ISO 8601 format'),
    description: z.string().optional().describe('Optional description'),
    allDay: z.boolean().optional().describe('Whether this is an all-day event'),
    rrule: z.string().optional().describe('Recurrence rule string (RFC 5545 RRULE)'),
  },
  async ({ title, startAt, endAt, description, allDay, rrule }) => runTool(() =>
    daybookFetch('/api/calendar', {
      method: 'POST',
      body: JSON.stringify({ title, startAt, endAt, description, allDay, rrule }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: list_journal_entries
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_journal_entries',
  'List journal entries, optionally filtered by month.',
  { month: z.string().optional().describe("Month filter in YYYY-MM format, e.g. '2024-06'") },
  async ({ month }) => runTool(async () => {
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    return daybookFetch(`/api/journal${qs}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: create_journal_entry
// ---------------------------------------------------------------------------
mcpServer.tool(
  'create_journal_entry',
  'Create a new journal entry.',
  {
    content: z.string().describe('Body text of the journal entry'),
    title: z.string().optional().describe('Optional title'),
    mood: z.string().optional().describe("Mood label, e.g. 'happy', 'neutral', 'sad'"),
    tags: z.array(z.string()).optional().describe('Array of tag strings'),
    entryDate: z.string().optional().describe('Date of the entry (YYYY-MM-DD); defaults to today'),
  },
  async ({ content, title, mood, tags, entryDate }) => runTool(() =>
    daybookFetch('/api/journal', {
      method: 'POST',
      body: JSON.stringify({ content, title, mood, tags, entryDate }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: list_transactions
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_transactions',
  'List financial transactions, optionally filtered by type and date range.',
  {
    type: z.enum(['income', 'expense']).optional().describe("Transaction type: 'income' or 'expense'"),
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ type, from, to }) => runTool(async () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return daybookFetch(`/api/expenses${qs}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: create_transaction
// ---------------------------------------------------------------------------
mcpServer.tool(
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
  async ({ type, amount, description, date, categoryId, notes, merchant }) => runTool(() =>
    daybookFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ type, amount, description, date, categoryId, notes, merchant }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: get_pl_report
// ---------------------------------------------------------------------------
mcpServer.tool(
  'get_pl_report',
  'Get a profit & loss report for a date range, optionally grouped.',
  {
    from: z.string().describe('Start date (YYYY-MM-DD)'),
    to: z.string().describe('End date (YYYY-MM-DD)'),
    groupBy: z.enum(['day', 'week', 'month', 'category']).optional().describe("Group results by 'day', 'week', 'month', or 'category'"),
  },
  async ({ from, to, groupBy }) => runTool(async () => {
    const params = new URLSearchParams({ from, to });
    if (groupBy) params.set('groupBy', groupBy);
    return daybookFetch(`/api/expenses/reports?${params.toString()}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: export_transactions_csv
// ---------------------------------------------------------------------------
mcpServer.tool(
  'export_transactions_csv',
  'Export transactions as CSV text, optionally filtered by date range.',
  {
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ from, to }) => runTool(async () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return daybookFetch(`/api/expenses/export${qs}`);
  }),
);

// ---------------------------------------------------------------------------
// Tool: update_transaction
// ---------------------------------------------------------------------------
mcpServer.tool(
  'update_transaction',
  'Update an existing financial transaction by ID.',
  {
    id: z.string().describe('The transaction ID to update'),
    type: z.enum(['income', 'expense']).optional().describe("Transaction type: 'income' or 'expense'"),
    amount: z.number().positive().optional().describe('New amount as a positive number'),
    description: z.string().optional().describe('New description'),
    date: z.string().optional().describe('New date (YYYY-MM-DD)'),
    categoryId: z.string().optional().describe('New expense category ID'),
    notes: z.string().optional().describe('New notes'),
    merchant: z.string().optional().describe('New merchant or payee name'),
  },
  async ({ id, type, amount, description, date, categoryId, notes, merchant }) => runTool(async () => {
    const body: Record<string, unknown> = {};
    if (type !== undefined) body.type = type;
    if (amount !== undefined) body.amount = amount;
    if (description !== undefined) body.description = description;
    if (date !== undefined) body.date = date;
    if (categoryId !== undefined) body.categoryId = categoryId;
    if (notes !== undefined) body.notes = notes;
    if (merchant !== undefined) body.merchant = merchant;
    return daybookFetch(`/api/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }),
);

// ---------------------------------------------------------------------------
// Tool: list_expense_categories
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_expense_categories',
  'List all expense and income categories.',
  {},
  async () => runTool(() => daybookFetch('/api/expenses/categories')),
);

// ---------------------------------------------------------------------------
// Tool: create_expense_category
// ---------------------------------------------------------------------------
mcpServer.tool(
  'create_expense_category',
  'Create a new expense or income category.',
  {
    name: z.string().describe('Category name'),
    type: z.enum(['expense', 'income']).describe("Category type: 'expense' or 'income'"),
    color: z.string().optional().describe("Optional hex color, e.g. '#6366f1'"),
  },
  async ({ name, type, color }) => runTool(() =>
    daybookFetch('/api/expenses/categories', {
      method: 'POST',
      body: JSON.stringify({ name, type, color }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: delete_expense_category
// ---------------------------------------------------------------------------
mcpServer.tool(
  'delete_expense_category',
  'Delete an expense/income category by its ID.',
  { id: z.string().describe('The category ID to delete') },
  async ({ id }) => runTool(() => daybookFetch(`/api/expenses/categories/${id}`, { method: 'DELETE' })),
);

// ---------------------------------------------------------------------------
// Tool: list_todo_categories
// ---------------------------------------------------------------------------
mcpServer.tool(
  'list_todo_categories',
  'List all todo categories.',
  {},
  async () => runTool(() => daybookFetch('/api/todos/categories')),
);

// ---------------------------------------------------------------------------
// Tool: create_todo_category
// ---------------------------------------------------------------------------
mcpServer.tool(
  'create_todo_category',
  'Create a new todo category.',
  {
    name: z.string().describe('Category name'),
    color: z.string().optional().describe("Optional hex color, e.g. '#6366f1'"),
  },
  async ({ name, color }) => runTool(() =>
    daybookFetch('/api/todos/categories', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Tool: delete_todo_category
// ---------------------------------------------------------------------------
mcpServer.tool(
  'delete_todo_category',
  'Delete a todo category by its ID.',
  { id: z.string().describe('The category ID to delete') },
  async ({ id }) => runTool(() => daybookFetch(`/api/todos/categories/${id}`, { method: 'DELETE' })),
);

// ---------------------------------------------------------------------------
// Express app with OAuth + MCP endpoint
// ---------------------------------------------------------------------------
const authProvider = new DaybookAuthProvider();
const issuerUrl = new URL(MCP_SERVER_URL);

const app = express();
app.use(express.json());

// OAuth discovery + token + registration endpoints
app.use(mcpAuthRouter({ provider: authProvider, issuerUrl, scopesSupported: [] }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'daybook-mcp' });
});

// MCP endpoint — protected by bearer token
// resourceMetadataUrl tells Claude where to find OAuth discovery when it gets a 401
const resourceMetadataUrl = `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/mcp`;
app.all('/mcp', requireBearerAuth({ verifier: authProvider, resourceMetadataUrl }), async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Daybook MCP server listening on http://0.0.0.0:${PORT}`);
  console.log(`  MCP endpoint : ${MCP_SERVER_URL}/mcp`);
  console.log(`  Health check : ${MCP_SERVER_URL}/health`);
  console.log(`  API base URL : ${DAYBOOK_API_URL}`);
});
