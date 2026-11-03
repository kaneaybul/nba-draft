const DAY_MS = 86400000;

function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  // Date.parse normalizes impossible dates such as February 30.
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed / DAY_MS : NaN;
}

function fresh(value, label, today, futureDays = 0) {
  const age = calendarDay(today) - calendarDay(value);
  if (!Number.isFinite(age) || age < -futureDays || age > 3) {
    throw Error(`${label} stale or invalid: ${value}`);
  }
}

export function validateRatingSourceDates(epmDate, darkoThrough, today) {
  // Expected EPM is a forecast for a game date, using preceding career data.
  // Its default page can advance to tomorrow on a league off day. DARKO's
  // ratingsThrough is an observation cutoff and must never be in the future.
  fresh(epmDate, 'Expected EPM', today, 1);
  fresh(darkoThrough, 'DARKO', today);
}
