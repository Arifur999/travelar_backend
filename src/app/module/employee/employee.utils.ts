/**
 * A calendar day pinned to UTC midnight.
 *
 * The column is @db.Date, so only the date part survives — but normalising here
 * means the uniqueness check and the stored value agree. The implementation
 * this replaces normalised writes with local setHours(0,0,0,0) and filtered
 * reads with a UTC string, so near midnight the two disagreed by a day.
 */
export const startOfDayUtc = (input: string | Date): Date => {
  const source = typeof input === "string" ? new Date(input) : input;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
};

/** "09:30 AM" -> minutes since midnight. Null when it does not parse. */
const parseTimeToMinutes = (text?: string | null): number | null => {
  if (!text) return null;

  const match = text.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]!.toUpperCase();

  if (hours < 1 || hours > 12 || minutes > 59) return null;

  if (meridiem === "AM" && hours === 12) hours = 0;
  if (meridiem === "PM" && hours !== 12) hours += 12;

  return hours * 60 + minutes;
};

/**
 * Hours between two wall-clock times, to two decimals.
 *
 * An end before the start is read as an overnight shift rather than an error,
 * which is how these agencies actually staff late airport runs.
 */
export const calcTotalHours = (startTime?: string | null, endTime?: string | null): number | null => {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null) return null;

  let diff = end - start;
  if (diff < 0) diff += 24 * 60;

  return Math.round((diff / 60) * 100) / 100;
};

/**
 * How long someone has been here, in whole months plus leftover days.
 *
 * Counts to the resign date when there is one, otherwise to today. Borrows from
 * the previous month's length when the day-of-month has not come round yet, so
 * "1 month 30 days" never appears.
 */
export const calcWorkingDuration = (joinDate: Date, resignDate: Date | null) => {
  const end = resignDate ?? new Date();

  if (end < joinDate) return { workingMonths: 0, workingDays: 0 };

  let months = (end.getFullYear() - joinDate.getFullYear()) * 12 + (end.getMonth() - joinDate.getMonth());
  let days = end.getDate() - joinDate.getDate();

  if (days < 0) {
    months -= 1;
    const previousMonthLength = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += previousMonthLength;
  }

  return { workingMonths: Math.max(months, 0), workingDays: Math.max(days, 0) };
};
