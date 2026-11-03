import { expect, it } from 'vitest';
import { formatRecordedDate } from '../../src/lib/date-format';
import { validateContract, validatorsReady } from '../../src/contracts';
import { apiChat } from './scenarios';
import { compareNewestRecordedDates } from '../../src/domain/date-time';

it('preserves valid contract timestamps the browser cannot represent', async () => {
  const leapSecond = '2016-12-31T23:59:60Z';
  await validatorsReady;
  const build = { ...apiChat(), updated_at: leapSecond };
  expect(validateContract('BuildSnapshot', build).ok).toBe(true);
  expect(formatRecordedDate(leapSecond, 'date')).toBe(leapSecond);
  expect(formatRecordedDate(leapSecond, 'date-time')).toBe(leapSecond);
});

it('sorts recorded dates by instant, precision and leap seconds with missing dates last', () => {
  const timestamps = [
    '',
    '2016-12-31T23:59:59.999Z',
    '2016-12-31T23:59:60Z',
    '2017-01-01T00:00:00Z',
    '2017-01-01T01:00:00.0000001+01:00',
  ];
  expect(timestamps.sort(compareNewestRecordedDates)).toEqual([
    '2017-01-01T01:00:00.0000001+01:00',
    '2017-01-01T00:00:00Z',
    '2016-12-31T23:59:60Z',
    '2016-12-31T23:59:59.999Z',
    '',
  ]);
});

it('formats representable timestamps and preserves an unparseable recorded value', () => {
  const timestamp = '2026-10-19T12:00:00Z';
  expect(formatRecordedDate(timestamp, 'date-time')).toBe(new Date(timestamp).toLocaleString());
  expect(formatRecordedDate('unrecognized timestamp', 'date-time')).toBe('unrecognized timestamp');
  expect(formatRecordedDate('', 'date')).toBe('unknown date');
});
