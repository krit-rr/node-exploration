import type { Contact, RehearsalEntry } from '@/types';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';
import { lastSubject } from '@/utils/interactions';

/**
 * Name rehearsal: Anki for people. The forgetting curve says most of a
 * new name is gone within a day, so the context captured at an event
 * (where you met, who introduced you, the note you typed) is replayed on
 * an expanding schedule and the user has to produce the name. Only people
 * with a met-at or a `remember` tag are in rotation. The schedule lives on
 * the contact row (`rehearsal`), like snoozes and orbit intent, so it
 * follows the account across devices and survives sign-out.
 */

export type { RehearsalEntry } from '@/types';

/** Days until the next card after each successful recall. */
export const REHEARSAL_INTERVALS = [1, 3, 7, 14, 30, 60] as const;
export const REMEMBER_TAG = 'remember';
/** Cards per sitting; the header says how many more are waiting. */
export const SESSION_SIZE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RehearsalCard {
  contact: Contact;
  email: string;
  /** True for a card never rehearsed before. */
  fresh: boolean;
  /** Days past due, 0 for a fresh card. */
  overdueDays: number;
  /** The context shown before the name, with the name itself blanked out. */
  prompt: { metAt?: string; company?: string; industry?: string; introducedBy?: string; note?: string; tags: string[] };
}

/** A stored entry, or undefined when malformed: a bad step must never index the intervals. */
export function sanitizeEntry(raw: unknown): RehearsalEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Partial<RehearsalEntry>;
  const due = typeof entry.due === 'string' && !isNaN(new Date(entry.due).getTime()) ? entry.due : undefined;
  if (!due) return undefined;
  const step = Number.isInteger(entry.step) ? Math.min(Math.max(entry.step as number, 0), REHEARSAL_INTERVALS.length - 1) : 0;
  const reps = Number.isInteger(entry.reps) && (entry.reps as number) >= 0 ? (entry.reps as number) : 0;
  const lastResult = entry.lastResult === 'got' || entry.lastResult === 'missed' ? entry.lastResult : undefined;
  return { due, step, reps, ...(lastResult ? { lastResult } : {}) };
}

/** People worth rehearsing: a captured met-at, or a deliberate `remember` tag. */
export function rehearsalCandidates(contacts: Contact[]): Contact[] {
  return contacts.filter(c => {
    if (c.isSpam || AUTOMATED_ADDRESS.test(c.email)) return false;
    if (!c.name || c.name === c.email) return false;
    return Boolean(c.metAt?.trim()) || (c.tags ?? []).some(t => t.toLowerCase() === REMEMBER_TAG);
  });
}

/**
 * Blank the contact's own name out of a prompt line, so a note like "Sarah
 * from Acme, follow up" cannot hand the answer over before the reveal.
 */
export function redactName(text: string, name: string): string {
  const tokens = name.split(/[\s,.'"()-]+/).filter(t => t.length >= 3);
  let out = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '…');
  }
  return out;
}

function promptFor(contact: Contact): RehearsalCard['prompt'] {
  const name = contact.name;
  const note = contact.notes?.trim() ? contact.notes.trim().slice(0, 240) : lastSubject(contact);
  return {
    metAt: contact.metAt?.trim() ? redactName(contact.metAt.trim(), name) : undefined,
    company: contact.company?.trim() ? redactName(contact.company.trim(), name) : undefined,
    industry: contact.industry?.trim() || undefined,
    introducedBy: contact.introducedBy?.trim() ? redactName(contact.introducedBy.trim(), name) : undefined,
    note: note ? redactName(note, name) : undefined,
    tags: (contact.tags ?? []).map(t => redactName(t, name)),
  };
}

function firstSeen(contact: Contact): number {
  const times = [
    ...(contact.interactions ?? []).map(i => new Date(i.date).getTime()),
    contact.createdAt ? new Date(contact.createdAt).getTime() : NaN,
  ].filter(t => !isNaN(t));
  return times.length ? Math.min(...times) : 0;
}

/** The cards due now, most overdue first, then newest-met first; at most one sitting's worth. */
export function dueCards(contacts: Contact[], now = Date.now(), limit = SESSION_SIZE): RehearsalCard[] {
  const cards: (RehearsalCard & { seen: number })[] = [];
  for (const contact of rehearsalCandidates(contacts)) {
    const email = contact.email.toLowerCase();
    const entry = sanitizeEntry(contact.rehearsal);
    const seen = firstSeen(contact);
    if (!entry) {
      cards.push({ contact, email, fresh: true, overdueDays: 0, prompt: promptFor(contact), seen });
      continue;
    }
    const due = new Date(entry.due).getTime();
    if (due <= now) {
      cards.push({ contact, email, fresh: false, overdueDays: Math.floor((now - due) / DAY_MS), prompt: promptFor(contact), seen });
    }
  }
  return cards
    .sort((a, b) => b.overdueDays - a.overdueDays || b.seen - a.seen)
    .slice(0, limit)
    .map(({ seen: _seen, ...card }) => card);
}

/** Everyone in rotation, how many are due, and when the next card comes back. */
export function rotation(contacts: Contact[], now = Date.now()): { total: number; due: number; nextDueDays: number | null } {
  const candidates = rehearsalCandidates(contacts);
  let due = 0;
  let next: number | null = null;
  for (const contact of candidates) {
    const entry = sanitizeEntry(contact.rehearsal);
    const dueAt = entry ? new Date(entry.due).getTime() : now;
    if (dueAt <= now) due++;
    else next = next === null ? dueAt : Math.min(next, dueAt);
  }
  return { total: candidates.length, due, nextDueDays: next === null ? null : Math.max(1, Math.ceil((next - now) / DAY_MS)) };
}

/** Got it: the interval grows, to a cap. Missed: back to tomorrow. The rep count always grows. */
export function nextEntry(previous: unknown, result: 'got' | 'missed', now = Date.now()): RehearsalEntry {
  const before = sanitizeEntry(previous);
  const step = result === 'got'
    ? Math.min((before?.step ?? -1) + 1, REHEARSAL_INTERVALS.length - 1)
    : 0;
  return {
    due: new Date(now + REHEARSAL_INTERVALS[step] * DAY_MS).toISOString(),
    step,
    reps: (before?.reps ?? 0) + 1,
    lastResult: result,
  };
}
