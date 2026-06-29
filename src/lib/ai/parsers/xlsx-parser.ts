import * as XLSX from 'xlsx';
import { detectColumns, normalizeRows, ColumnMap, ParsedTransaction } from './csv-parser';

export function parseXLSX(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const raw = (XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    dateNF: 'YYYY-MM-DD',
    defval: '',
  }) as unknown) as unknown[][];

  if (raw.length < 2) return { headers: [], rows: [] };

  const headers = (raw[0] as string[]).map((h) => String(h ?? '').trim());
  const rows = raw.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String((row as unknown[])[i] ?? '').trim();
    });
    return obj;
  });

  return { headers, rows };
}

export function parseXLSXToTransactions(buffer: Buffer): {
  headers: string[];
  columnMap: ColumnMap;
  transactions: ParsedTransaction[];
} {
  const { headers, rows } = parseXLSX(buffer);
  const columnMap = detectColumns(headers);
  const transactions = normalizeRows(rows, columnMap);
  return { headers, columnMap, transactions };
}
