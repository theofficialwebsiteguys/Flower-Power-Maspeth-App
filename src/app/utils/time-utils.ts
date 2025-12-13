/* ---------------- Types ---------------- */

export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DayHours = {
  open: string;   // "HH:mm"
  close: string;  // "HH:mm"
};

export type HoursMap = Partial<Record<DayIndex, DayHours>>;
export type HoursRangesMap = Partial<Record<DayIndex, DayHours[]>>;

/* ---------------- Day Helpers ---------------- */

const DAY_INDEX_MAP: Record<string, DayIndex> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/* ---------------- Normalizers ---------------- */

/**
 * Converts backend storeHours[] into HoursMap
 */
export function storeHoursToHoursMap(
  storeHours: { day: string; startTime: string; endTime: string }[] | undefined
): HoursMap {
  if (!Array.isArray(storeHours)) return {};

  return storeHours.reduce<HoursMap>((acc, h) => {
    if (!h?.day) return acc;

    const key = DAY_INDEX_MAP[h.day.slice(0, 3).toLowerCase()];
    if (key === undefined) return acc;

    acc[key] = {
      open: normalizeTime(h.startTime),
      close: normalizeTime(h.endTime),
    };

    return acc;
  }, {});
}

/**
 * Ensures HH:mm format (fixes "21:0" → "21:00")
 */
export function normalizeTime(t?: string): string {
  if (!t) return '00:00';

  const [h, m] = t.split(':');
  return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
}

/* ---------------- Time / TZ Helpers ---------------- */

export function getTodayKeyTZ(tz = 'America/New_York'): DayIndex {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: tz,
  }).formatToParts(new Date());

  const wd = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
  return DAY_INDEX_MAP[wd.slice(0, 3).toLowerCase()] ?? 0;
}

export function nowMinutesTZ(tz = 'America/New_York'): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).formatToParts(new Date());

  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function parseMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHumanTZ(hhmm: string, tz = 'America/New_York'): string {
  const [h, m] = normalizeTime(hhmm).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);

  return d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

/* ---------------- Range Logic ---------------- */

export function inNowRangeTZ(
  start: string,
  end: string,
  tz = 'America/New_York',
  treatMidnightAsEndOfDay = true
): boolean {
  const now = nowMinutesTZ(tz);
  const s = parseMinutes(start);
  let e = parseMinutes(end);

  if (treatMidnightAsEndOfDay && e === 0) e = 24 * 60;

  if (e > s) return now >= s && now < e;   // same day
  if (e < s) return now >= s || now < e;   // overnight
  return false;
}

/* ---------------- Public UI Helpers ---------------- */

export function hoursLabelToday(
  map: HoursMap | undefined,
  tz = 'America/New_York'
): string {
  if (!map) return 'Hours unavailable';

  const key = getTodayKeyTZ(tz);
  const day = map[key];
  if (!day) return 'Hours unavailable';

  return `${toHumanTZ(day.open, tz)} – ${toHumanTZ(day.close, tz)}`;
}

export function isOpenToday(
  map: HoursMap | undefined,
  tz = 'America/New_York'
): boolean {
  if (!map) return false;

  const key = getTodayKeyTZ(tz);
  const day = map[key];
  if (!day) return false;

  return inNowRangeTZ(day.open, day.close, tz, true);
}

export function anyRangeNow(
  ranges: DayHours[] | undefined,
  tz = 'America/New_York'
): boolean {
  if (!ranges?.length) return false;
  return ranges.some(r => inNowRangeTZ(r.open, r.close, tz, true));
}

export function rangesLabel(
  ranges: DayHours[] | undefined,
  tz = 'America/New_York'
): string {
  if (!ranges?.length) return '';
  return ranges
    .map(r => `${toHumanTZ(r.open, tz)} – ${toHumanTZ(r.close, tz)}`)
    .join(', ');
}
