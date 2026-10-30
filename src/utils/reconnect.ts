import { Contact } from '@/types';

export interface ReconnectCandidate {
  contact: Contact;
  daysSince: number;
  /** True when no touch was ever recorded and daysSince counts from when Node first saw them. */
  neverTouched: boolean;
  lastSubject?: string;
  priority: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default: a relationship starts "going cold" after 45 untouched days. */
export const DEFAULT_COLD_DAYS = 45;

/**
 * The one tag that marks a priority relationship. Any other tag is just
 * organization (webinar, investor, climate) and says nothing about how much
 * the person matters, so it must not reorder the queue.
 */
export const PRIORITY_TAG = 'key-contact';

/**
 * Priority means the user deliberately marked the person out: tagged
 * key-contact, or put in a group. `priorityEmails` carries the group
 * membership, which lives outside the contact row.
 */
export function isPriorityContact(contact: Contact, priorityEmails?: Set<string>): boolean {
  if ((contact.tags ?? []).some(t => t.toLowerCase() === PRIORITY_TAG)) return true;
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

/**
 * The reconnect queue: real contacts going cold, oldest first.
 * Excludes spam-flagged contacts, obvious non-people (no-reply/newsletter
 * style addresses), and anything currently snoozed.
 */
export function computeReconnectQueue(
  contacts: Contact[],
  {
    coldDays = DEFAULT_COLD_DAYS,
    limit = 5,
    priorityEmails,
  }: { coldDays?: number; limit?: number; priorityEmails?: Set<string> } = {}
): ReconnectCandidate[] {
  const now = Date.now();
  const candidates: ReconnectCandidate[] = [];

  for (const contact of contacts) {
    if (contact.isSpam) continue;
    if (contact.snoozedUntil && new Date(contact.snoozedUntil).getTime() > now) continue;
    if (/^(no-?reply|noreply|newsletter|notifications?|marketing|updates|info|support|hello)@/i.test(contact.email)) continue;

    const touch = lastTouchTime(contact);
    if (!touch) continue;
    const daysSince = Math.floor((now - touch.time) / DAY_MS);
    if (daysSince < coldDays) continue;

    const sent = (contact.interactions ?? []).filter(i => i.type === 'sent');
    const lastWithSubject = [...sent].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .find(i => i.subject);

    candidates.push({
      contact,
      daysSince,
      neverTouched: touch.neverTouched,
      lastSubject: lastWithSubject?.subject,
      priority: isPriorityContact(contact, priorityEmails),
    });
  }

  // Priority relationships first (key-contact or in a group), then the
  // oldest: the ones closest to being lost.
  candidates.sort((a, b) =>
    a.priority === b.priority ? b.daysSince - a.daysSince : (a.priority ? -1 : 1)
  );
  return candidates.slice(0, limit);
}
