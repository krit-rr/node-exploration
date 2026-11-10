import type { Contact } from '@/types';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';

/**
 * Name rehearsal: Anki for people. The forgetting curve says most of a
 * new name is gone within a day, so the context captured at an event
 * (where you met, who introduced you, the note you typed) is replayed on
 * an expanding schedule and the user has to produce the name. Only people
 * with a met-at or a `remember` tag are in rotation; the schedule lives
 * in localStorage per user and is purged on sign-out.
 */

/** Days until the next card after each successful recall. */
export const REHEARSAL_INTERVALS = [1, 3, 7, 14, 30, 60] as const;
export const REMEMBER_TAG = 'remember';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RehearsalEntry {
  /** ISO time the card is due again. */
  due: string;
  /** Index into REHEARSAL_INTERVALS reached by successive recalls. */
  step: number;
  reps: number;
  lastResult?: 'got' | 'missed';
}

export type RehearsalState = Record<string, RehearsalEntry>;

export interface RehearsalCard {
  contact: Contact;
  email: string;
  /** True for a card never rehearsed before. */
  fresh: boolean;
  /** Days past due, 0 for a fresh card. */
  overdueDays: number;
}

/** People worth rehearsing: a captured met-at, or a deliberate `remember` tag. */
export function rehearsalCandidates(contacts: Contact[]): Contact[] {
  return contacts.filter(c => {
    if (c.isSpam || AUTOMATED_ADDRESS.test(c.email)) return false;
    if (!c.name || c.name === c.email) return false;
    return Boolean(c.metAt?.trim()) || (c.tags ?? []).some(t => t.toLowerCase() === REMEMBER_TAG);
  });
}

function firstSeen(contact: Contact): number {
  const times = [
    ...(contact.interactions ?? []).map(i => new Date(i.date).getTime()),
    contact.createdAt ? new Date(contact.createdAt).getTime() : NaN,
  ].filter(t => !isNaN(t));
  return times.length ? Math.min(...times) : 0;
}

/** The cards due now: fresh ones and overdue ones, most overdue first, then newest-met first. */
export function dueCards(contacts: Contact[], state: RehearsalState, now = Date.now(), limit = 10): RehearsalCard[] {
  const cards: RehearsalCard[] = [];
  for (const contact of rehearsalCandidates(contacts)) {
    const email = contact.email.toLowerCase();
    const entry = state[email];
    if (!entry) {
      cards.push({ contact, email, fresh: true, overdueDays: 0 });
      continue;
    }
    const due = new Date(entry.due).getTime();
    if (isNaN(due) || due <= now) {
      cards.push({ contact, email, fresh: false, overdueDays: isNaN(due) ? 0 : Math.floor((now - due) / DAY_MS) });
    }
  }
  return cards
    .sort((a, b) => b.overdueDays - a.overdueDays || firstSeen(b.contact) - firstSeen(a.contact))
    .slice(0, limit);
}

/** Everyone in rotation, with when the next card is due. */
export function rotation(contacts: Contact[], state: RehearsalState, now = Date.now()): { total: number; due: number; nextDueDays: number | null } {
  const candidates = rehearsalCandidates(contacts);
  let due = 0;
  let next: number | null = null;
  for (const contact of candidates) {
    const entry = state[contact.email.toLowerCase()];
    const dueAt = entry ? new Date(entry.due).getTime() : now;
    if (isNaN(dueAt) || dueAt <= now) due++;
    else next = next === null ? dueAt : Math.min(next, dueAt);
  }
  return { total: candidates.length, due, nextDueDays: next === null ? null : Math.max(1, Math.ceil((next - now) / DAY_MS)) };
}

/** Got it: the interval grows. Missed: back to tomorrow. */
export function recordResult(state: RehearsalState, email: string, result: 'got' | 'missed', now = Date.now()): RehearsalState {
  const key = email.toLowerCase();
  const previous = state[key];
  const step = result === 'got'
    ? Math.min((previous?.step ?? -1) + 1, REHEARSAL_INTERVALS.length - 1)
    : 0;
  const days = REHEARSAL_INTERVALS[step];
  return {
    ...state,
    [key]: {
      due: new Date(now + days * DAY_MS).toISOString(),
      step,
      reps: (previous?.reps ?? 0) + 1,
      lastResult: result,
    },
  };
}

const STATE_PREFIX = 'rehearsal_';

export function readRehearsalState(userEmail: string): RehearsalState {
  try {
    const raw = localStorage.getItem(`${STATE_PREFIX}${userEmail}`);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RehearsalState) : {};
  } catch {
    return {};
  }
}

export function writeRehearsalState(userEmail: string, state: RehearsalState): void {
  try {
    localStorage.setItem(`${STATE_PREFIX}${userEmail}`, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save the rehearsal schedule:', error);
  }
}
