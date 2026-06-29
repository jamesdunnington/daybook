import Link from 'next/link';
import { getSession } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { todos, calendarEvents, journalEntries, expenseTransactions } from '@/lib/db/schema';
import { eq, and, lte, gte, inArray, desc } from 'drizzle-orm';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, TrendingUp, Calendar, BookOpen, ArrowRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addDays, startOfDay, endOfDay } from 'date-fns';

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getMoodEmoji(mood: string | null): string {
  const map: Record<string, string> = {
    great: '😄',
    good: '😊',
    neutral: '😐',
    bad: '😕',
    terrible: '😢',
  };
  return mood ? (map[mood] ?? '') : '';
}

async function getDashboardData(userId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const sevenDaysLater = addDays(now, 7);

  // 1. Todos today: pending or in_progress, due today or overdue
  const todayTodos = await db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        inArray(todos.status, ['pending', 'in_progress']),
        lte(todos.dueDate, todayEnd)
      )
    );

  // 2. This month net P&L
  const monthTransactions = await db
    .select({ type: expenseTransactions.type, amount: expenseTransactions.amount })
    .from(expenseTransactions)
    .where(
      and(
        eq(expenseTransactions.userId, userId),
        gte(expenseTransactions.date, monthStart),
        lte(expenseTransactions.date, monthEnd)
      )
    );

  let income = 0;
  let expenses = 0;
  for (const t of monthTransactions) {
    const amt = parseFloat(String(t.amount));
    if (t.type === 'income') income += amt;
    else expenses += amt;
  }
  const netPnl = income - expenses;

  // 3. Upcoming events in next 7 days
  const upcomingEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        gte(calendarEvents.startAt, now),
        lte(calendarEvents.startAt, sevenDaysLater)
      )
    )
    .orderBy(calendarEvents.startAt);

  // 4. Journal streak: consecutive days with entries up to today
  // Fetch all entry dates for the past 365 days (generous window)
  const yearAgo = addDays(now, -365);
  const allEntries = await db
    .select({ entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, userId),
        gte(journalEntries.entryDate, yearAgo)
      )
    );

  // Build a Set of date strings like 'YYYY-MM-DD'
  const entryDates = new Set(
    allEntries.map((e) => format(e.entryDate, 'yyyy-MM-dd'))
  );

  let streak = 0;
  let checkDate = new Date(now);
  while (true) {
    const dateStr = format(checkDate, 'yyyy-MM-dd');
    if (entryDates.has(dateStr)) {
      streak++;
      checkDate = addDays(checkDate, -1);
    } else {
      break;
    }
  }

  // 5. Recent incomplete todos (last 5)
  const recentTodos = await db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        inArray(todos.status, ['pending', 'in_progress'])
      )
    )
    .orderBy(desc(todos.createdAt))
    .limit(5);

  // 6. Next 3 upcoming events
  const nextThreeEvents = upcomingEvents.slice(0, 3);

  return {
    todayTodosCount: todayTodos.length,
    netPnl,
    upcomingEventsCount: upcomingEvents.length,
    streak,
    recentTodos,
    nextThreeEvents,
  };
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.user.id;
  const userName = session.user.name;

  const {
    todayTodosCount,
    netPnl,
    upcomingEventsCount,
    streak,
    recentTodos,
    nextThreeEvents,
  } = await getDashboardData(userId);

  const summaryCards = [
    {
      title: 'Todos Today',
      value: String(todayTodosCount),
      description: 'pending or in progress',
      icon: CheckSquare,
      href: '/todos',
      iconColor: 'text-blue-500',
    },
    {
      title: 'This Month',
      value: formatCurrency(netPnl),
      description: 'net income vs expenses',
      icon: TrendingUp,
      href: '/expenses',
      iconColor: netPnl >= 0 ? 'text-emerald-500' : 'text-red-500',
    },
    {
      title: 'Upcoming Events',
      value: String(upcomingEventsCount),
      description: 'in the next 7 days',
      icon: Calendar,
      href: '/calendar',
      iconColor: 'text-violet-500',
    },
    {
      title: 'Journal Streak',
      value: `${streak} day${streak !== 1 ? 's' : ''}`,
      description: 'consecutive days with entries',
      icon: BookOpen,
      href: '/journal',
      iconColor: 'text-amber-500',
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {userName.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <Link key={card.title} href={card.href} className="block group">
            <Card className="h-full transition-shadow group-hover:ring-ring/30">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <card.icon className={`h-4 w-4 shrink-0 ${card.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-2xl font-bold leading-none">{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Bottom two-column section */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent todos */}
        <Card>
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Recent Todos</CardTitle>
              <Link
                href="/todos"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {recentTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No pending todos. You&apos;re all caught up!
              </p>
            ) : (
              <ul className="space-y-2">
                {recentTodos.map((todo) => (
                  <li key={todo.id} className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        todo.status === 'in_progress'
                          ? 'bg-blue-500'
                          : 'bg-muted-foreground/40'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{todo.title}</p>
                      {todo.dueDate && (
                        <p
                          className={`text-xs ${
                            todo.dueDate < new Date()
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}
                        >
                          Due {format(todo.dueDate, 'MMM d')}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={todo.priority === 'high' ? 'destructive' : 'outline'}
                      className="shrink-0 text-xs capitalize"
                    >
                      {todo.priority}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming events */}
        <Card>
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Upcoming Events</CardTitle>
              <Link
                href="/calendar"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {nextThreeEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No upcoming events in the next 7 days.
              </p>
            ) : (
              <ul className="space-y-3">
                {nextThreeEvents.map((event) => (
                  <li key={event.id} className="flex items-start gap-2">
                    <div
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: event.color ?? '#6366f1' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.allDay
                          ? format(event.startAt, 'MMM d')
                          : format(event.startAt, 'MMM d, h:mm a')}
                      </p>
                      {event.location && (
                        <p className="text-xs text-muted-foreground truncate">
                          {event.location}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
