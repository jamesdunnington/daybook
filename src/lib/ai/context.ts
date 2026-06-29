import { db } from '@/lib/db';
import { todos, calendarEvents, journalEntries, expenseTransactions, expenseCategories } from '@/lib/db/schema';
import { eq, and, gte, lte, count, sum, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export async function buildSystemContext(userId: string): Promise<string> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [todoStats, upcomingEvents, recentMood, monthlyExpenses] = await Promise.all([
    // Todo counts
    db
      .select({ status: todos.status, cnt: count() })
      .from(todos)
      .where(eq(todos.userId, userId))
      .groupBy(todos.status),

    // Upcoming calendar events
    db
      .select({ title: calendarEvents.title, startAt: calendarEvents.startAt })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          gte(calendarEvents.startAt, now),
          lte(calendarEvents.startAt, in14Days)
        )
      )
      .orderBy(calendarEvents.startAt)
      .limit(5),

    // Latest journal mood
    db
      .select({ mood: journalEntries.mood, entryDate: journalEntries.entryDate })
      .from(journalEntries)
      .where(eq(journalEntries.userId, userId))
      .orderBy(desc(journalEntries.entryDate))
      .limit(1),

    // Monthly P&L
    db
      .select({
        type: expenseTransactions.type,
        total: sum(expenseTransactions.amount),
      })
      .from(expenseTransactions)
      .where(
        and(
          eq(expenseTransactions.userId, userId),
          gte(expenseTransactions.date, startOfMonth),
          lte(expenseTransactions.date, endOfMonth)
        )
      )
      .groupBy(expenseTransactions.type),
  ]);

  const pendingTodos = todoStats.find((r) => r.status === 'pending')?.cnt ?? 0;
  const completedTodos = todoStats.find((r) => r.status === 'completed')?.cnt ?? 0;
  const income = monthlyExpenses.find((r) => r.type === 'income')?.total ?? '0';
  const expense = monthlyExpenses.find((r) => r.type === 'expense')?.total ?? '0';
  const net = (parseFloat(income as string) - parseFloat(expense as string)).toFixed(2);

  const ctx = {
    date: now.toISOString().split('T')[0],
    todos: { pending: pendingTodos, completed: completedTodos },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: e.title,
      date: e.startAt?.toISOString().split('T')[0],
    })),
    thisMonth: {
      income: parseFloat(income as string).toFixed(2),
      expense: parseFloat(expense as string).toFixed(2),
      net,
    },
    latestMood: recentMood[0]?.mood ?? null,
  };

  return `You are Daybook AI, a helpful personal assistant. Today is ${ctx.date}.
User data summary:
- Todos: ${ctx.todos.pending} pending, ${ctx.todos.completed} completed
- Upcoming events (next 14 days): ${ctx.upcomingEvents.map((e) => `${e.title} on ${e.date}`).join(', ') || 'none'}
- This month finances: Income $${ctx.thisMonth.income}, Expenses $${ctx.thisMonth.expense}, Net $${ctx.thisMonth.net}
- Latest mood: ${ctx.latestMood ?? 'not recorded'}

You can help the user with todos, calendar, journal entries, and expense tracking. When importing financial data from uploaded files, extract transactions and suggest expense categories. Be concise and helpful.`;
}
