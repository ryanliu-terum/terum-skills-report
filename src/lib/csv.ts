/** RFC 4180 CSV: a field with a comma, quote or line break is quoted; quotes are doubled. */

export type CsvValue = string | number | boolean | undefined;

const field = (value: CsvValue): string => {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(columns: readonly string[], rows: readonly Record<string, CsvValue>[]): string {
  const lines = [columns.map(field).join(',')];
  for (const row of rows) lines.push(columns.map((column) => field(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}
