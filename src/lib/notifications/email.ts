import nodemailer from 'nodemailer';
import { db } from '@/lib/db';
import { appSettings, notificationLog } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

async function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendEmail(params: {
  userId: string;
  to: string;
  subject: string;
  html: string;
  type: string;
}) {
  const transporter = await getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP not configured — skipping email send');
    return;
  }

  const from = process.env.SMTP_FROM ?? 'Daybook <noreply@daybook.local>';

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    await db.insert(notificationLog).values({
      userId: params.userId,
      channel: 'email',
      type: params.type,
      payload: { to: params.to, subject: params.subject },
      status: 'sent',
    });
  } catch (err) {
    await db.insert(notificationLog).values({
      userId: params.userId,
      channel: 'email',
      type: params.type,
      payload: { to: params.to, subject: params.subject },
      status: 'failed',
      error: String(err),
    });
    throw err;
  }
}

export function buildDailyDigestHtml(data: {
  userName: string;
  pendingTodos: number;
  todayEvents: { title: string; startAt: string }[];
  monthlyNet: string;
}): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2>Good morning, ${data.userName}!</h2>
      <p>Here's your Daybook daily digest:</p>
      <h3>Todos</h3>
      <p>You have <strong>${data.pendingTodos}</strong> pending todos.</p>
      <h3>Today's Events</h3>
      ${
        data.todayEvents.length
          ? data.todayEvents.map((e) => `<p>• ${e.title} at ${e.startAt}</p>`).join('')
          : '<p>No events today.</p>'
      }
      <h3>Finances</h3>
      <p>Monthly net: <strong>${data.monthlyNet}</strong></p>
      <hr />
      <p style="color:#888;font-size:12px">Daybook — your personal productivity app</p>
    </div>
  `;
}
