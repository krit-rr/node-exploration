import type { Contact } from '@/types';
import { AUTOMATED_ADDRESS, assessCadence } from '@/utils/reconnect';
import { closenessScore, hash, rankPriority, workDomain } from '@/utils/orbit';

/**
 * Intros worth making. The most valuable thing a networker does for other
 * people is introduce them, and the research is clear about where the
 * value sits: across the gaps between groups (Burt's structural holes),
 * through ties that are moderately weak rather than strongest (Rajkumar
 * et al.'s LinkedIn experiments). So a candidate pair is two people whose
 * profiles are alike (embedding similarity, computed in Postgres with no
 * model call) who are not colleagues, have not been on an email together
 * as far as the record shows, and are both people the user has actually
 * written to recently, so the user can vouch for each to the other.
 */

export interface SimilarPair {
  a: string;
  b: string;
  /** Cosine similarity of the two contacts' profile embeddings, 0 to 1. */
  similarity: number;
}

export interface IntroPerson {
  email: string;
  name: string;
  company?: string;
  industry?: string;
  daysSince: number;
}

export interface IntroSuggestion {
  /** Stable for the pair whichever way round it comes; dismissals hang on it. */
  key: string;
  a: IntroPerson;
  b: IntroPerson;
  similarity: number;
  score: number;
  /** What makes the two alike: "Both in Fintech", or "Lumenworks and Acme, similar profiles". */
  alike: string;
  /** The longer of the two silences in days: the user has written to both within this. */
  withinDays: number;
  /** True when the mail record names the other people on each email, so the thread check ran rather than being assumed. */
  threadsChecked: boolean;
  /** The one-line reason, built from the fields above. */
  reason: string;
}

/** You can only vouch for someone you have written to recently. */
export const MAX_SILENCE_DAYS = 180;
/** Below this the two profiles are not alike enough to be worth a sentence. */
const MIN_SIMILARITY = 0.35;

export function pairKey(a: string, b: string): string {
  return hash([a.toLowerCase(), b.toLowerCase()].sort().join('|')).toString(36);
}

function onAnEmailTogether(a: Contact, b: Contact): boolean {
  const bEmail = b.email.toLowerCase();
  const aEmail = a.email.toLowerCase();
  const aHasB = (a.interactions ?? []).some(i => (i.participants ?? []).some(p => p.toLowerCase() === bEmail));
  const bHasA = (b.interactions ?? []).some(i => (i.participants ?? []).some(p => p.toLowerCase() === aEmail));
  return aHasB || bHasA;
}

function introducedEachOther(a: Contact, b: Contact): boolean {
  const byA = (b.introducedBy ?? '').trim().toLowerCase();
  const byB = (a.introducedBy ?? '').trim().toLowerCase();
  return (byA !== '' && byA === a.name.trim().toLowerCase()) || (byB !== '' && byB === b.name.trim().toLowerCase());
}

/** Colleagues: the same company, or the same work domain (checked separately: one of the two may have no company on record). */
function colleagues(a: Contact, b: Contact): boolean {
  const companyA = a.company?.trim().toLowerCase();
  if (companyA && companyA === b.company?.trim().toLowerCase()) return true;
  const domainA = workDomain(a.email);
  return Boolean(domainA) && domainA === workDomain(b.email);
}

/** Everything that says these two already know each other, or are too close to need an intro. */
export function alreadyConnected(a: Contact, b: Contact): boolean {
  return colleagues(a, b) || onAnEmailTogether(a, b) || introducedEachOther(a, b);
}

/**
 * True when any interaction on record names the other people on the email.
 * Without that the "never on an email together" check cannot run, and the
 * reason must not claim it did.
 */
export function participantsRecorded(contacts: Contact[]): boolean {
  return contacts.some(c => (c.interactions ?? []).some(i => (i.participants?.length ?? 0) > 0));
}

function describe(contact: Contact): string {
  return contact.company?.trim() || contact.industry?.trim() || 'a similar profile';
}

/** "the last day", "the last 9 days", "the last 3 weeks", "the last 4 months". */
export function withinText(days: number): string {
  if (days >= 60) return `the last ${Math.floor(days / 30)} months`;
  if (days >= 14) return `the last ${Math.round(days / 7)} weeks`;
  if (days >= 2) return `the last ${days} days`;
  return 'the last day';
}

export function alikeText(a: Contact, b: Contact): string {
  const industryA = a.industry?.trim();
  const industryB = b.industry?.trim();
  return industryA && industryB && industryA.toLowerCase() === industryB.toLowerCase()
    ? `Both in ${industryA}`
    : `${describe(a)} and ${describe(b)}, similar profiles`;
}

export function introReason(alike: string, withinDays: number, threadsChecked: boolean): string {
  const apart = threadsChecked ? 'never on an email together' : 'not colleagues';
  return `${alike}, ${apart}, and you have written to both in ${withinText(withinDays)}.`;
}

export function suggestIntros(
  contacts: Contact[],
  pairs: SimilarPair[],
  { limit = 5, now = Date.now(), priorityEmails }: { limit?: number; now?: number; priorityEmails?: Set<string> } = {}
): IntroSuggestion[] {
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (contact.isSpam || AUTOMATED_ADDRESS.test(email)) continue;
    byEmail.set(email, contact);
  }
  const assessments = assessCadence(contacts, undefined, now);
  const threadsChecked = participantsRecorded(contacts);

  const seen = new Set<string>();
  const suggestions: IntroSuggestion[] = [];
  for (const pair of pairs) {
    const aEmail = pair.a.toLowerCase();
    const bEmail = pair.b.toLowerCase();
    if (aEmail === bEmail || pair.similarity < MIN_SIMILARITY) continue;
    const key = pairKey(aEmail, bEmail);
    if (seen.has(key)) continue;
    seen.add(key);
    const a = byEmail.get(aEmail);
    const b = byEmail.get(bEmail);
    const ta = assessments.get(aEmail);
    const tb = assessments.get(bEmail);
    if (!a || !b || !ta || !tb) continue;
    // You can only vouch for people you have actually written to, and recently.
    if (ta.neverTouched || tb.neverTouched) continue;
    if (ta.daysSince > MAX_SILENCE_DAYS || tb.daysSince > MAX_SILENCE_DAYS) continue;
    if (alreadyConnected(a, b)) continue;
    const closeness = Math.sqrt(
      closenessScore(ta, rankPriority(a, priorityEmails)) * closenessScore(tb, rankPriority(b, priorityEmails))
    );
    const person = (c: Contact, days: number): IntroPerson => ({
      email: c.email.toLowerCase(),
      name: c.name || c.email,
      company: c.company?.trim() || undefined,
      industry: c.industry?.trim() || undefined,
      daysSince: days,
    });
    const alike = alikeText(a, b);
    const withinDays = Math.max(ta.daysSince, tb.daysSince);
    suggestions.push({
      key,
      a: person(a, ta.daysSince),
      b: person(b, tb.daysSince),
      similarity: pair.similarity,
      score: pair.similarity * closeness,
      alike,
      withinDays,
      threadsChecked,
      reason: introReason(alike, withinDays, threadsChecked),
    });
  }
  return suggestions.sort((x, y) => y.score - x.score).slice(0, limit);
}

const DISMISSED_PREFIX = 'dismissed-intros_';

export function readDismissedIntros(userEmail: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${DISMISSED_PREFIX}${userEmail}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function dismissIntro(userEmail: string, key: string): Set<string> {
  const dismissed = readDismissedIntros(userEmail);
  dismissed.add(key);
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${userEmail}`, JSON.stringify(Array.from(dismissed)));
  } catch (error) {
    console.error('Failed to remember the dismissed intro:', error);
  }
  return dismissed;
}
