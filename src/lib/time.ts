const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "When did I last read this", in Traditional Chinese, rendered on the server so
 * there is no locale or timezone to disagree about at hydration time.
 *
 * Past a week the relative form stops being informative -- "23 天前" tells you
 * less than a date does -- so it falls back to a calendar date.
 */
export function relativeTime(
  seconds: number | null,
  now: number = Math.floor(Date.now() / 1000),
): string {
  if (seconds === null) return '尚未閱讀';

  const ago = now - seconds;
  if (ago < 0) return '剛剛';
  if (ago < MINUTE) return '剛剛';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} 分鐘前`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} 小時前`;
  if (ago < 2 * DAY) return '昨天';
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)} 天前`;

  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
