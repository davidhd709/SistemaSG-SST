const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function businessDay(value: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** PostgreSQL DATE values are represented by Prisma as UTC midnight. */
export function businessDate(value: Date): Date {
  return new Date(`${businessDay(value)}T00:00:00.000Z`);
}
