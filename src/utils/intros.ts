import type { Contact } from '@/types';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';
import { computeOrbit } from '@/utils/orbit';

/**
 * Intros worth making. The most valuable thing a networker does for other
 * people is introduce them, and the research is clear about where the
 * value sits: across the gaps between groups (Burt's structural holes),
 * through ties that are moderately weak rather than strongest (Rajkumar
 * et al.'s LinkedIn experiments). So a candidate pair is two people whose
 * profiles are alike (embedding similarity, computed in Postgres with no
 * model call) who have never been on an email together, are not
 * colleagues, and are both people the user is actually in touch with, so
 * the user can vouch for each to the other.
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
  reason: string;
}

/** You can only vouch for someone you are in touch with. */
const MAX_SILENCE_DAYS = 180;
/** Below this the two profiles are not alike enough to be worth a sentence. */
const MIN_SIMILARITY = 0.35;
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

function hash(text: string): number {
  let h = 5381;
  for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

export function pairKey(a: string, b: string): string {
  return hash([a.toLowerCase(), b.toLowerCase()].sort().join('|')).toString(36);
}

function workDomain(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain && !CONSUMER_DOMAINS.has(domain) ? domain : null;
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

/** Everything that says these two already know each other, or are too close to need an intro. */
export function alreadyConnected(a: Contact, b: Contact): boolean {
  const companyA = a.company?.trim().toLowerCase();
  const companyB = b.company?.trim().toLowerCase();
  if (companyA && companyA === companyB) return true;
  const domainA = workDomain(a.email);
  if (domainA && domainA === workDomain(b.email)) return true;
  return onAnEmailTogether(a, b) || introducedEachOther(a, b);
}

function describe(contact: Contact): string {
  return contact.company?.trim() || contact.industry?.trim() || 'a similar profile';
}

function weeks(days: number): string {
  return days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`;
}

export function introReason(a: Contact, b: Contact, daysA: number, daysB: number): string {
  const industryA = a.industry?.trim();
  const industryB = b.industry?.trim();
  const alike = industryA && industryB && industryA.toLowerCase() === industryB.toLowerCase()
    ? `Both in ${industryA}`
    : `${describe(a)} and ${describe(b)}, similar profiles`;
  const recent = weeks(Math.max(daysA, daysB));
  return `${alike}, never on an email together, and you have written to both in the last ${recent}.`;
}

export function suggestIntros(
  contacts: Contact[],
  pairs: SimilarPair[],
  { limit = 5, now = Date.now() }: { limit?: number; now?: number } = {}
): IntroSuggestion[] {
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (contact.isSpam || AUTOMATED_ADDRESS.test(email)) continue;
    byEmail.set(email, contact);
  }
  const orbit = new Map(computeOrbit(contacts, { now }).points.map(p => [p.email, p]));

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
    const pa = orbit.get(aEmail);
    const pb = orbit.get(bEmail);
    if (!a || !b || !pa || !pb) continue;
    if (pa.assessment.daysSince > MAX_SILENCE_DAYS || pb.assessment.daysSince > MAX_SILENCE_DAYS) continue;
    if (alreadyConnected(a, b)) continue;
    const score = pair.similarity * Math.sqrt(pa.closeness * pb.closeness);
    const person = (c: Contact, days: number): IntroPerson => ({
      email: c.email.toLowerCase(),
      name: c.name || c.email,
      company: c.company?.trim() || undefined,
      industry: c.industry?.trim() || undefined,
      daysSince: days,
    });
    suggestions.push({
      key,
      a: person(a, pa.assessment.daysSince),
      b: person(b, pb.assessment.daysSince),
      similarity: pair.similarity,
      score,
      reason: introReason(a, b, pa.assessment.daysSince, pb.assessment.daysSince),
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
