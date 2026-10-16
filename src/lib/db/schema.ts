import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  uuid,
  jsonb,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ─── BETTER AUTH CORE TABLES ─────────────────────────────────────────────────

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  role: text('role').notNull().default('user'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const userSettings = pgTable('user_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  openrouterApiKey: text('openrouter_api_key'),
  preferredModel: text('preferred_model').default('openai/gpt-4o-mini'),
  timezone: text('timezone').default('UTC'),
  currency: text('currency').default('USD'),
  telegramChatId: text('telegram_chat_id'),
  telegramLinkCode: text('telegram_link_code'),
  emailNotifications: boolean('email_notifications').default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── API KEYS ─────────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').array().default([]),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── TODOS ────────────────────────────────────────────────────────────────────

export const todoCategories = pgTable('todo_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').default('#6366f1'),
  icon: text('icon'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => todoCategories.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('pending'),
    dueDate: timestamp('due_date'),
    completedAt: timestamp('completed_at'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('todos_user_idx').on(t.userId),
    index('todos_due_date_idx').on(t.dueDate),
  ]
);

// ─── CALENDAR ─────────────────────────────────────────────────────────────────

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    color: text('color').default('#6366f1'),
    rrule: text('rrule'),
    recurringParentId: uuid('recurring_parent_id'),
    exceptionDate: timestamp('exception_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('calendar_user_start_idx').on(t.userId, t.startAt)]
);

// ─── JOURNAL ──────────────────────────────────────────────────────────────────

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entryDate: timestamp('entry_date').notNull(),
    title: text('title'),
    content: text('content').notNull().default(''),
    mood: text('mood'),
    tags: text('tags').array().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('journal_user_date_idx').on(t.userId, t.entryDate)]
);

export const journalPhotos = pgTable('journal_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id')
    .notNull()
    .references(() => journalEntries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  caption: text('caption'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('expense'),
  color: text('color').default('#10b981'),
  icon: text('icon'),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const expenseTransactions = pgTable(
  'expense_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => expenseCategories.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    description: text('description').notNull(),
    date: timestamp('date').notNull(),
    notes: text('notes'),
    merchant: text('merchant'),
    importedFrom: text('imported_from'),
    importBatchId: uuid('import_batch_id'),
    externalId: text('external_id'),
    receiptUrl: text('receipt_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('expense_user_date_idx').on(t.userId, t.date),
    index('expense_batch_idx').on(t.importBatchId),
  ]
);

// ─── AI CHAT ──────────────────────────────────────────────────────────────────

export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New Chat'),
  model: text('model').notNull().default('openai/gpt-4o-mini'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    attachments: jsonb('attachments').$type<
      Array<
        | {
            filename: string;
            type: 'csv' | 'xlsx';
            parsedRowCount: number;
            importBatchId: string;
          }
        | {
            filename: string;
            type: 'image';
            mimeType: string;
            uploadId: string;
            url: string;
          }
      >
    >(),
    toolCalls: jsonb('tool_calls').$type<
      Array<{
        name: string;
        summary: string;
        undoId?: string;
        undoExpiresAt?: string;
      }>
    >(),
    tokenCount: integer('token_count'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_messages_conv_idx').on(t.conversationId)]
);

// ─── AI TOOL UNDO LOG ─────────────────────────────────────────────────────────

export const aiUndoActions = pgTable('ai_undo_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => aiConversations.id, {
    onDelete: 'cascade',
  }),
  toolName: text('tool_name').notNull(),
  summary: text('summary').notNull(),
  undoData: jsonb('undo_data').notNull().$type<
    | {
        kind: 'restore_row';
        table:
          | 'todos'
          | 'calendarEvents'
          | 'journalEntries'
          | 'expenseTransactions'
          | 'expenseCategories'
          | 'todoCategories'
          | 'projects'
          | 'projectMilestones'
          | 'projectPages';
        row: Record<string, unknown>;
      }
    | { kind: 'delete_rows_by_batch'; importBatchId: string }
  >(),
  expiresAt: timestamp('expires_at').notNull(),
  undoneAt: timestamp('undone_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── POWER TAB (PROJECTS) ─────────────────────────────────────────────────────

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  color: text('color').default('#0D9488'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const projectPages = pgTable(
  'project_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => projectPages.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull().default('Untitled'),
    content: jsonb('content').$type<unknown[]>().default([]),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('project_pages_project_idx').on(t.projectId)]
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    unitLabel: text('unit_label').notNull().default('items'),
    targetCount: numeric('target_count', { precision: 12, scale: 2 }).notNull(),
    targetDate: timestamp('target_date'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('project_milestones_project_idx').on(t.projectId)]
);

export const projectActivityLog = pgTable(
  'project_activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id, {
      onDelete: 'set null',
    }),
    countValue: numeric('count_value', { precision: 12, scale: 2 }).notNull().default('1'),
    entryDate: timestamp('entry_date').notNull().defaultNow(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('project_activity_log_project_idx').on(t.projectId, t.entryDate),
    index('project_activity_log_milestone_idx').on(t.milestoneId),
  ]
);

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export const notificationLog = pgTable('notification_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
  status: text('status').notNull().default('sent'),
  error: text('error'),
});

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type TodoCategory = typeof todoCategories.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalPhoto = typeof journalPhotos.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type ExpenseTransaction = typeof expenseTransactions.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiUndoAction = typeof aiUndoActions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPage = typeof projectPages.$inferSelect;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type ProjectActivityLogEntry = typeof projectActivityLog.$inferSelect;
