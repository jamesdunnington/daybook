import { parse } from 'csv-parse/sync';

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'posting date', 'trans date', 'trade date'],
  amount: ['amount', 'sum', 'value', 'total'],
  debit: ['debit', 'withdrawal', 'dr', 'debit amount'],
  credit: ['credit', 'deposit', 'cr', 'credit amount'],
  description: ['description', 'narration', 'particulars', 'details', 'memo', 'note', 'remarks', 'transaction details', 'reference'],
  merchant: ['merchant', 'payee', 'vendor', 'name', 'beneficiary'],
};

export interface ColumnMap {
  date: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  description: string | null;
  merchant: string | null;
}

export interface ParsedTransaction {
  date: string;
  amount: number;
  type: 'income' | 'expense';
  description: string;
  merchant: string | null;
}

export function parseCSV(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  if (!records.length) return { headers: [], rows: [] };
  return { headers: Object.keys(records[0]), rows: records };
}

export function detectColumns(headers: string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const map: ColumnMap = { date: null, amount: null, debit: null, credit: null, description: null, merchant: null };

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = lower.findIndex((h) => h === alias || h.includes(alias));
      if (idx !== -1) {
        (map as unknown as Record<string, string | null>)[field] = headers[idx];
        break;
      }
    }
  }
  return map;
}

function parseAmount(value: string): number {
  return parseFloat(value.replace(/[^0-9.\-]/g, '')) || 0;
}

function parseDate(value: string): string {
  const cleaned = value.trim();
  // Try ISO first
  const iso = new Date(cleaned);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  // Try DD/MM/YYYY or DD-MM-YYYY
  const match = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (match) {
    const [, d, m, y] = match;
    const year = y.length === 2 ? '20' + y : y;
    return new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).toISOString();
  }

  return new Date().toISOString();
}

export function normalizeRows(
  rows: Record<string, string>[],
  columnMap: ColumnMap
): ParsedTransaction[] {
  return rows
    .map((row) => {
      const dateVal = columnMap.date ? row[columnMap.date] : '';
      const description = columnMap.description ? row[columnMap.description] : '';
      const merchant = columnMap.merchant ? row[columnMap.merchant] ?? null : null;

      let amount = 0;
      let type: 'income' | 'expense' = 'expense';

      if (columnMap.debit && columnMap.credit) {
        const debit = parseAmount(row[columnMap.debit] ?? '0');
        const credit = parseAmount(row[columnMap.credit] ?? '0');
        if (credit > 0) {
          amount = credit;
          type = 'income';
        } else if (debit > 0) {
          amount = debit;
          type = 'expense';
        }
      } else if (columnMap.amount) {
        const raw = parseAmount(row[columnMap.amount] ?? '0');
        if (raw < 0) {
          amount = Math.abs(raw);
          type = 'expense';
        } else {
          amount = raw;
          type = 'income';
        }
      }

      return {
        date: parseDate(dateVal),
        amount,
        type,
        description: description || 'Unknown',
        merchant: merchant || null,
      };
    })
    .filter((r) => r.amount > 0);
}
