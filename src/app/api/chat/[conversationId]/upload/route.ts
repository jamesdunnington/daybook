import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { parseCSV, detectColumns, normalizeRows } from '@/lib/ai/parsers/csv-parser';
import { parseXLSXToTransactions } from '@/lib/ai/parsers/xlsx-parser';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await params; // consume

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    return NextResponse.json({ error: 'Only CSV and XLSX files are supported' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Save raw file for audit
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  const importDir = path.join(uploadDir, 'imports', userId);
  await fs.mkdir(importDir, { recursive: true });
  const savedFilename = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(importDir, savedFilename), buffer);

  let transactions;
  let columnMap;
  let warnings: string[] = [];

  if (ext === 'csv') {
    const { headers: cols, rows } = parseCSV(buffer);
    if (!cols.length) {
      return NextResponse.json({ error: 'Could not parse CSV — empty or invalid file' }, { status: 400 });
    }
    columnMap = detectColumns(cols);
    if (!columnMap.date) warnings.push('Could not detect date column — using today\'s date');
    if (!columnMap.amount && !columnMap.debit && !columnMap.credit) {
      warnings.push('Could not detect amount column — all amounts will be 0');
    }
    transactions = normalizeRows(rows, columnMap);
  } else {
    const result = parseXLSXToTransactions(buffer);
    transactions = result.transactions;
    columnMap = result.columnMap;
  }

  const importBatchId = randomUUID();

  return NextResponse.json({
    importBatchId,
    filename: file.name,
    savedAs: savedFilename,
    columnMap,
    warnings,
    totalRows: transactions.length,
    previewRows: transactions.slice(0, 5),
    transactions,
  });
}
