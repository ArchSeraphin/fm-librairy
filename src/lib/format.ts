import { getFormatter } from 'next-intl/server';

/** Server-side date formatting. Use in server components. */
export async function formatDate(date: Date | string): Promise<string> {
  const formatter = await getFormatter();
  return formatter.dateTime(typeof date === 'string' ? new Date(date) : date, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Server-side date+time formatting. Use in server components. */
export async function formatDateTime(date: Date | string): Promise<string> {
  const formatter = await getFormatter();
  return formatter.dateTime(typeof date === 'string' ? new Date(date) : date, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
