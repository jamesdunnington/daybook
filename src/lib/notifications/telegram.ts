import { Bot, Context } from 'grammy';
import { db } from '@/lib/db';
import { userSettings, user, notificationLog } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

let bot: Bot | null = null;

export function getTelegramBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  if (!bot) {
    bot = new Bot(token);
    setupBotHandlers(bot);
  }
  return bot;
}

export async function startTelegramBot() {
  const b = getTelegramBot();
  if (!b) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }
  console.log('[telegram] Starting Telegram bot...');
  // Long-polling — no webhook needed for self-hosted
  b.start({ onStart: () => console.log('[telegram] Bot is running') });
}

function setupBotHandlers(b: Bot) {
  b.command('start', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const linkCode = randomBytes(4).toString('hex').toUpperCase();

    // Store link code temporarily (we'll match it when user enters it in app)
    // Use a simple in-memory map for now (could use Redis for multi-instance)
    pendingLinks.set(linkCode, { chatId, expiresAt: Date.now() + 10 * 60 * 1000 });

    await ctx.reply(
      `Welcome to Daybook!\n\nTo link your account, enter this code in your Daybook app settings:\n\n` +
      `*${linkCode}*\n\nCode expires in 10 minutes.`,
      { parse_mode: 'Markdown' }
    );
  });

  b.command('summary', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.telegramChatId, chatId),
    });
    if (!settings) {
      await ctx.reply('Link your Daybook account first with /start');
      return;
    }
    await ctx.reply('Getting your summary...');
    // Summary logic would call the same context builder
    await ctx.reply('✅ Feature coming soon — please check the app for your summary.');
  });

  b.command('todos', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.telegramChatId, chatId),
    });
    if (!settings) {
      await ctx.reply('Link your account first with /start');
      return;
    }
    await ctx.reply('📋 Check your todos in the Daybook app: ' + (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000') + '/todos');
  });

  b.on('message', async (ctx) => {
    await ctx.reply('Commands: /start — link account | /todos — view todos | /summary — daily summary');
  });
}

// In-memory pending link codes (acceptable for single-instance Docker)
const pendingLinks = new Map<string, { chatId: string; expiresAt: number }>();

export async function linkTelegramAccount(userId: string, linkCode: string): Promise<boolean> {
  const entry = pendingLinks.get(linkCode.toUpperCase());
  if (!entry || entry.expiresAt < Date.now()) return false;

  await db
    .update(userSettings)
    .set({ telegramChatId: entry.chatId, telegramLinkCode: null })
    .where(eq(userSettings.userId, userId));

  pendingLinks.delete(linkCode.toUpperCase());
  return true;
}

export async function sendTelegramMessage(params: {
  userId: string;
  chatId: string;
  text: string;
  type: string;
}) {
  const b = getTelegramBot();
  if (!b) return;

  try {
    await b.api.sendMessage(params.chatId, params.text, { parse_mode: 'Markdown' });
    await db.insert(notificationLog).values({
      userId: params.userId,
      channel: 'telegram',
      type: params.type,
      payload: { chatId: params.chatId, text: params.text },
      status: 'sent',
    });
  } catch (err) {
    await db.insert(notificationLog).values({
      userId: params.userId,
      channel: 'telegram',
      type: params.type,
      payload: { chatId: params.chatId },
      status: 'failed',
      error: String(err),
    });
  }
}
