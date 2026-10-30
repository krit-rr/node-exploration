import { Contact } from '@/types';
import { isPriorityContact } from '@/utils/reconnect';

export interface NetworkScoreResult {
  score: number;
  trend: 'up' | 'down' | 'stable';
  metrics: {
    weekOverWeek: number;
    activeRelationships: number;
    active90: number;
    networkReach: number;
    priorityCount: number;
    weekTrend: 'up' | 'down' | 'stable';
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computed network health, from real data only. Sources: lastContacted per
 * contact and the bounded per-contact sent-interaction history.
 *
 * When the user has marked out a priority network (key-contact tag or
 * group members), the score measures THAT subset: the people they chose to
 * care about, which is the number that should move when they clear the
 * reconnect queue. With no priority set it falls back to the whole network.
 */
export function calculateNetworkScore(
  contacts: Contact[],
  priorityEmails?: Set<string>
): NetworkScoreResult {
  const now = Date.now();
  const priorityContacts = contacts.filter(c => isPriorityContact(c, priorityEmails));
  const usePriority = priorityContacts.length >= 3;
  const scored = usePriority ? priorityContacts : contacts;
  const total = scored.length;

  let active30 = 0;
  let active90 = 0;
  let sentThisWeek = 0;
  let sentLastWeek = 0;

  for (const contact of scored) {
    const last = contact.lastContacted ? new Date(contact.lastContacted).getTime() : NaN;
    if (!isNaN(last)) {
      const daysAgo = (now - last) / DAY_MS;
      if (daysAgo <= 30) active30++;
      if (daysAgo <= 90) active90++;
    }

    const dates = contact.interactions?.length
      ? contact.interactions.filter(i => i.type === 'sent').map(i => i.date)
      : contact.sentDates ?? [];
    for (const date of dates) {
      const t = new Date(date).getTime();
      if (isNaN(t)) continue;
      const daysAgo = (now - t) / DAY_MS;
      if (daysAgo <= 7) sentThisWeek++;
      else if (daysAgo <= 14) sentLastWeek++;
    }
  }

  const weekOverWeek = sentLastWeek === 0
    ? (sentThisWeek > 0 ? 100 : 0)
    : Math.round((100 * (sentThisWeek - sentLastWeek)) / sentLastWeek);

  // How alive the network is: weight recent touch share, with a size factor
  // so a two-contact network can't score 100.
  const score = total === 0
    ? 0
    : Math.round(100 * (
        0.45 * (active30 / total) +
        0.35 * (active90 / total) +
        0.20 * Math.min(1, total / (usePriority ? 50 : 150))
      ));

  const weekTrend: NetworkScoreResult['trend'] =
    weekOverWeek > 10 ? 'up' : weekOverWeek < -10 ? 'down' : 'stable';

  return {
    score,
    trend: weekTrend,
    metrics: {
      weekOverWeek,
      activeRelationships: active30,
      active90,
      networkReach: contacts.length,
      priorityCount: usePriority ? priorityContacts.length : 0,
      weekTrend,
    },
  };
}
