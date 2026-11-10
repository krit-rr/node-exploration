import type { Contact } from '@/types';

/**
 * Reminiscence, cheaply: "a year ago this week you met Alex at Climate
 * Week" needs only when Node first knew someone and where. It is a reason
 * to write that costs nothing to run and never calls a model.
 */

export interface Anniversary {
  email: string;
  name: string;
  metAt: string;
  years: number;
  /** The day it happened this year or last, ISO date. */
  on: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Three days either side of the date count as this week. */
export const WINDOW_DAYS = 3;

/** When Node first knew this person: the row's creation, or the oldest message when that is older. */
export function firstKnown(contact: Contact): number | null {
  const times = (contact.interactions ?? []).map(i => new Date(i.date).getTime()).filter(t => !Number.isNaN(t));
  const created = contact.createdAt ? new Date(contact.createdAt).getTime() : NaN;
  if (!Number.isNaN(created)) times.push(created);
  return times.length ? Math.min(...times) : null;
}

/** People met this week one or more years ago, the oldest anniversaries first. */
export function onThisDay(contacts: Contact[], now = Date.now()): Anniversary[] {
  const out: Anniversary[] = [];
  const today = new Date(now);
  // Whole days, so a date three days off counts whatever the time of day.
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const contact of contacts) {
    const metAt = contact.metAt?.trim();
    if (!metAt || contact.isSpam) continue;
    const first = firstKnown(contact);
    if (first === null) continue;
    const then = new Date(first);
    for (const year of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const years = year - then.getUTCFullYear();
      if (years < 1) continue;
      const date = Date.UTC(year, then.getUTCMonth(), then.getUTCDate());
      if (Math.abs(Math.round((todayStart - date) / DAY_MS)) > WINDOW_DAYS) continue;
      out.push({ email: contact.email.toLowerCase(), name: contact.name || contact.email, metAt, years, on: new Date(date).toISOString().slice(0, 10) });
      break;
    }
  }
  return out.sort((a, b) => b.years - a.years || a.name.localeCompare(b.name));
}

export function yearsText(years: number): string {
  return years === 1 ? 'A year' : `${years} years`;
}

/** "A year ago this week you met Alex Rivera at Climate Week." */
export function anniversaryLine(anniversary: Anniversary): string {
  return `${yearsText(anniversary.years)} ago this week you met ${anniversary.name} at ${anniversary.metAt}.`;
}
