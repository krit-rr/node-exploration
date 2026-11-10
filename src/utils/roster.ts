/**
 * Event roster mode: the attendee list goes in before the event, you tick
 * who you met during it, and the triage deck is ready the morning after.
 * Only the people you tick become contacts; the rest never clutter the list.
 */

export interface RosterEntry {
  email: string;
  name: string;
  company?: string;
  position?: string;
}

export const MAX_ROSTER = 2000;
export const MAX_EVENT_NAME = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Rows as they come from a CSV or a request body, made safe: valid addresses, lower-cased, each once, capped. */
export function normalizeRosterEntries(rows: unknown[]): RosterEntry[] {
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const row of rows) {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const email = text(r.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    const name = text(r.name, 120) || email;
    const company = text(r.company, 120);
    const position = text(r.position, 120);
    seen.add(email);
    out.push({ email, name, ...(company ? { company } : {}), ...(position ? { position } : {}) });
    if (out.length >= MAX_ROSTER) break;
  }
  return out;
}

/** The roster without the people who became contacts. */
export function rosterWithout(entries: RosterEntry[], emails: Iterable<string>): RosterEntry[] {
  const gone = new Set(Array.from(emails, e => e.toLowerCase()));
  return entries.filter(entry => !gone.has(entry.email));
}

/** A quick search over name, email, company and position. */
export function searchRoster(entries: RosterEntry[], query: string): RosterEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(entry => [entry.name, entry.email, entry.company ?? '', entry.position ?? ''].some(field => field.toLowerCase().includes(q)));
}
