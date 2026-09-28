import { businessDate, businessDay } from './business-date';

describe('businessDate', () => {
  it('keeps a Colombian evening on the same work date after UTC midnight', () => {
    const moment = new Date('2026-08-25T02:00:00Z');
    expect(businessDay(moment)).toBe('2026-08-24');
    expect(businessDate(moment).toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });
});
