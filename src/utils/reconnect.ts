import { Contact } from '@/types';
import { AUTOMATED_ADDRESS } from '@/utils/addresses';
import {
  conversationGaps,
  estimateCadence,
  overdueProbability,
  overdueZ,
  priorFromGaps,
  touchDays,
  type CadenceEstimate,
} from '@/utils/cadence';
import { lastSubject } from '@/utils/interactions';

export { AUTOMATED_ADDRESS } from '@/utils/addresses';

export interface CadenceAssessment {
  daysSince: number;
  /** True when no touch was ever recorded and daysSince counts from when Node first saw them. */
  neverTouched: boolean;
  /** 0 to 1: the chance this silence is already past the pair's typical gap. */
  overdue: number;
  /** The same silence in spreads past the typical gap; unbounded, used for ranking. */
  overdueZ: number;
  cadence: CadenceEstimate;
  /** Distinct days the pair touched, all time and in the last year. */
  touchCount: number;
  touchesLastYear: number;
}

export interface ReconnectCandidate extends CadenceAssessment {
  contact: Contact;
  lastSubject?: string;
  priority: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default: a relationship with no rhythm of its own starts "going cold" after 45 untouched days. */
export const DEFAULT_COLD_DAYS = 45;

/** In the queue once the silence is more likely than not to be past the pair's typical gap. */
export const OVERDUE_THRESHOLD = 0.5;

/** Under two weeks of silence is ordinary life whatever the pair's rhythm; never flag it. */
export const MIN_SILENCE_DAYS = 14;

/**
 * The one tag that marks a priority relationship. Any other tag is just
 * organization (webinar, investor, climate) and says nothing about how much
 * the person matters, so it must not reorder the queue.
 */
export const PRIORITY_TAG = 'key-contact';

/**
 * Priority means the user deliberately marked the person out: tagged
 * key-contact, put in a group, or dragged into the inner two rings of the
 * orbit map. `priorityEmails` carries the group membership, which lives
 * outside the contact row.
 */
export function isPriorityContact(contact: Contact, priorityEmails?: Set<string>): boolean {
  if ((contact.tags ?? []).some(t => t.toLowerCase() === PRIORITY_TAG)) return true;
  if (contact.intendedLayer === 1 || contact.intendedLayer === 2) return true;
  return Boolean(priorityEmails?.has(contact.email.toLowerCase()));
}

/**
 * When the relationship was last touched, or failing that when Node first saw
 * the person. Someone imported without a date must still age into the queue
 * instead of being invisible forever.
 */
export function lastTouchTime(contact: Contact): { time: number; neverTouched: boolean } | null {
  const last = contact.lastContacted ? new Date(contact.lastContacted).getTime() : NaN;
  if (!isNaN(last)) return { time: last, neverTouched: false };
  const created = contact.createdAt ? new Date(contact.createdAt).getTime() : NaN;
  if (!isNaN(created)) return { time: created, neverTouched: true };
  return null;
}

/** Short durations for cards and emails: 9d, 3w, 4mo, 2y. */
export function since(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  if (days >= 14) return `${Math.round(days / 7)}w`;
  return `${days}d`;
}

/** The one line that says where this relationship stands. */
export function cadenceStatus(assessment: CadenceAssessment, { then = false }: { then?: boolean } = {}): string {
  // "ago" counts back from now; a replayed assessment counts back from the replayed moment.
  const ago = then ? 'before then' : 'ago';
  if (assessment.neverTouched) return `Added ${since(assessment.daysSince)} ${ago}, no touch yet`;
  if (assessment.cadence.source === 'pair') {
    return `Usually every ${since(Math.round(assessment.cadence.typicalDays))}, quiet for ${since(assessment.daysSince)}`;
  }
  return `Last touch ${since(assessment.daysSince)} ${ago}`;
}

/**
 * Every real contact's standing against its own rhythm, keyed by lowercase
 * email. The queue, the orbit map and the score read from this one place.
 * Spam-flagged and automated addresses are left out; snoozes are not
 * applied here because a snooze is a queue decision, not a fact about the
 * relationship. Each contact's touch days are read once.
 */
export function assessCadence(
  contacts: Contact[],
  coldDays = DEFAULT_COLD_DAYS,
  now = Date.now()
): Map<string, CadenceAssessment> {
  const eligible: { contact: Contact; email: string; touch: { time: number; neverTouched: boolean }; days: number[]; gaps: number[] }[] = [];
  for (const contact of contacts) {
    if (contact.isSpam) continue;
    if (AUTOMATED_ADDRESS.test(contact.email)) continue;
    const touch = lastTouchTime(contact);
    if (!touch) continue;
    const days = touchDays(contact);
    eligible.push({ contact, email: contact.email.toLowerCase(), touch, days, gaps: conversationGaps(days) });
  }
  const prior = priorFromGaps(eligible.map(e => e.gaps), coldDays);
  const today = Math.floor(now / DAY_MS);

  const assessments = new Map<string, CadenceAssessment>();
  for (const { email, touch, days, gaps } of eligible) {
    const daysSince = Math.floor((now - touch.time) / DAY_MS);
    const cadence = estimateCadence(gaps, prior);
    assessments.set(email, {
      daysSince,
      neverTouched: touch.neverTouched,
      overdue: overdueProbability(daysSince, cadence),
      overdueZ: overdueZ(daysSince, cadence),
      cadence,
      touchCount: days.length,
      touchesLastYear: days.filter(d => today - d <= 365).length,
    });
  }
  return assessments;
}

/** The queue's test, snooze aside: enough silence, and more likely than not past the pair's typical gap. */
export function isGoingCold(assessment: CadenceAssessment): boolean {
  return assessment.daysSince >= MIN_SILENCE_DAYS && assessment.overdue >= OVERDUE_THRESHOLD;
}

export function isSnoozed(contact: Contact, now = Date.now()): boolean {
  return Boolean(contact.snoozedUntil && new Date(contact.snoozedUntil).getTime() > now);
}

/**
 * The reconnect queue: real contacts going cold, judged against their own
 * rhythm. Excludes spam-flagged contacts, obvious non-people (no-reply and
 * newsletter style addresses), and anything currently snoozed.
 */
export function computeReconnectQueue(
  contacts: Contact[],
  {
    coldDays = DEFAULT_COLD_DAYS,
    limit = 5,
    priorityEmails,
    now = Date.now(),
  }: { coldDays?: number; limit?: number; priorityEmails?: Set<string>; now?: number } = {}
): ReconnectCandidate[] {
  const assessments = assessCadence(contacts, coldDays, now);
  const candidates: ReconnectCandidate[] = [];

  for (const contact of contacts) {
    const assessment = assessments.get(contact.email.toLowerCase());
    if (!assessment) continue;
    if (isSnoozed(contact, now)) continue;
    if (!isGoingCold(assessment)) continue;

    candidates.push({
      ...assessment,
      contact,
      lastSubject: lastSubject(contact),
      priority: isPriorityContact(contact, priorityEmails),
    });
  }

  // Priority relationships first (key-contact, group, or inner orbit), then
  // the furthest past their own rhythm, then the longest silence.
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    if (b.overdueZ !== a.overdueZ) return b.overdueZ - a.overdueZ;
    return b.daysSince - a.daysSince;
  });
  return candidates.slice(0, limit);
}
