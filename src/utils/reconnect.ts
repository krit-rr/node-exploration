import { Contact } from '@/types';

export interface ReconnectCandidate {
  contact: Contact;
  daysSince: number;
  lastSubject?: string;
  priority: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default: a relationship starts "going cold" after 45 untouched days. */
export const DEFAULT_COLD_DAYS = 45;

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

    const last = contact.lastContacted ? new Date(contact.lastContacted).getTime() : NaN;
    if (isNaN(last)) continue;
    const daysSince = Math.floor((now - last) / DAY_MS);
    if (daysSince < coldDays) continue;

    const sent = (contact.interactions ?? []).filter(i => i.type === 'sent');
    const lastWithSubject = [...sent].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .find(i => i.subject);

    const priority = Boolean(
      (contact.tags && contact.tags.length > 0) ||
      priorityEmails?.has(contact.email.toLowerCase())
    );
    candidates.push({ contact, daysSince, lastSubject: lastWithSubject?.subject, priority });
  }

  // Priority relationships first (tagged or in a group), then the oldest:
  // the ones closest to being lost.
  candidates.sort((a, b) =>
    a.priority === b.priority ? b.daysSince - a.daysSince : (a.priority ? -1 : 1)
  );
  return candidates.slice(0, limit);
}
