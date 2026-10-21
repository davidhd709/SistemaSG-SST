import { businessDate } from '../common/business-date';

export type ArlStatus = 'VIGENTE' | 'PROXIMA_A_VENCER' | 'VENCIDA';

/** Dates are evaluated as calendar days in UTC; the ARL end date remains valid throughout that day. */
export function calculateArlStatus(startDate: Date, endDate: Date, expiringDays: number, now = new Date()): ArlStatus {
  const today = businessDate(now).getTime();
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  if (start > today || end < today) return 'VENCIDA';
  return end <= today + Math.max(0, expiringDays) * 86_400_000 ? 'PROXIMA_A_VENCER' : 'VIGENTE';
}

/** Input is ordered by endDate descending, so the fallback is the latest record. */
export function selectArlAffiliation<T extends { startDate: Date; endDate: Date }>(
  affiliations: T[],
  now = new Date(),
): T | undefined {
  return (
    affiliations.find((item) => calculateArlStatus(item.startDate, item.endDate, 0, now) !== 'VENCIDA') ??
    affiliations[0]
  );
}
