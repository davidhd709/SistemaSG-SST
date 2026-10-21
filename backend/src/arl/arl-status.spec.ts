import { calculateArlStatus, selectArlAffiliation } from './arl-status';

describe('calculateArlStatus', () => {
  const now = new Date('2026-08-24T16:00:00.000Z');
  it('blocks ARL already expired', () =>
    expect(calculateArlStatus(new Date('2026-01-01'), new Date('2026-08-23'), 30, now)).toBe('VENCIDA'));
  it('flags ARL expiring within the configured threshold', () =>
    expect(calculateArlStatus(new Date('2026-01-01'), new Date('2026-08-29'), 5, now)).toBe('PROXIMA_A_VENCER'));
  it('keeps ARL valid outside the threshold', () =>
    expect(calculateArlStatus(new Date('2026-01-01'), new Date('2026-08-30'), 5, now)).toBe('VIGENTE'));
  it('uses the Colombian calendar day near UTC midnight', () =>
    expect(
      calculateArlStatus(new Date('2026-01-01'), new Date('2026-08-24'), 0, new Date('2026-08-25T02:00:00Z')),
    ).toBe('PROXIMA_A_VENCER'));
});

describe('selectArlAffiliation', () => {
  const now = new Date('2026-08-24T16:00:00.000Z');
  const current = { id: 'current', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const future = { id: 'future', startDate: new Date('2026-09-01'), endDate: new Date('2027-08-31') };

  it('uses the affiliation covering today ahead of a future affiliation', () => {
    expect(selectArlAffiliation([future, current], now)).toBe(current);
  });

  it('uses the latest record for information when none covers today', () => {
    expect(selectArlAffiliation([future], now)).toBe(future);
    expect(selectArlAffiliation([], now)).toBeUndefined();
  });
});
