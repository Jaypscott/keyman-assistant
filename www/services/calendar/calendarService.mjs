function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

function toISODate(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function monthStartISO(iso) {
  const parsed = parseISODate(iso);
  return parsed ? toISODate(parsed.year, parsed.month, 1) : "";
}

export function shiftCalendarDateByMonth(iso, monthDelta) {
  const parsed = parseISODate(iso);
  if (!parsed || !Number.isInteger(monthDelta)) return "";
  const target = new Date(parsed.year, parsed.month - 1 + monthDelta, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = Math.min(parsed.day, new Date(year, month, 0).getDate());
  return toISODate(year, month, day);
}

export function calendarMonthCells(monthISO) {
  const parsed = parseISODate(monthISO);
  if (!parsed) return [];
  const firstWeekday = new Date(parsed.year, parsed.month - 1, 1).getDay();
  const daysInMonth = new Date(parsed.year, parsed.month, 0).getDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => toISODate(parsed.year, parsed.month, index + 1),
    ),
  ];
}

export function eventsForMonth(events, monthISO) {
  const prefix = monthStartISO(monthISO).slice(0, 7);
  if (!prefix || !Array.isArray(events)) return [];
  return events.filter((event) => String(event?.date || "").startsWith(`${prefix}-`));
}

export function eventsForDate(events, iso) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event?.date === iso)
    .slice()
    .sort((a, b) => (
      String(a.start || "").localeCompare(String(b.start || ""))
      || String(a.end || "").localeCompare(String(b.end || ""))
      || String(a.locationName || "").localeCompare(String(b.locationName || ""))
      || String(a.shiftLabel || "").localeCompare(String(b.shiftLabel || ""))
    ));
}
