'use client';

import { useFormatter } from 'next-intl';

export function useDateFormat() {
  const formatter = useFormatter();
  return {
    date: (d: Date | string) =>
      formatter.dateTime(typeof d === 'string' ? new Date(d) : d, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    dateTime: (d: Date | string) =>
      formatter.dateTime(typeof d === 'string' ? new Date(d) : d, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
  };
}
