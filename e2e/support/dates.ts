import { dateObject, localDate, shiftDate } from '../../src/domain/model';

/**
 * The first Monday strictly after the real date. Everything due on it is still ahead, so it can be
 * planned and opened however the suite's clock falls.
 */
export function nextMonday(): string {
  const today = localDate();
  return shiftDate(today, 7 - ((dateObject(today).getDay() + 6) % 7));
}
