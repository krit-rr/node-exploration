import { Contact } from '@/types';

export interface NetworkScoreResult {
  score: number;
  trend: 'up' | 'down' | 'stable';
  metrics: {
    weekOverWeek: number;
    activeRelationships: number;
    active90: number;
    networkReach: number;
    weekTrend: 'up' | 'down' | 'stable';
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computed network health, from real data only. Sources: lastContacted per
 * contact, and the (bounded) per-contact sent-interaction history. The old
 * version hardcoded score 85, +12% week-over-week, and a 24h response time.
 */
export function calculateNetworkScore(contacts: Contact[]): NetworkScoreResult {
  const now = Date.now();
  const total = contacts.length;

  let active30 = 0;
  let active90 = 0;
  let sentThisWeek = 0;
  let sentLastWeek = 0;

  for (const contact of contacts) {
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
        0.20 * Math.min(1, total / 150)
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
      networkReach: total,
      weekTrend,
    },
  };
}
