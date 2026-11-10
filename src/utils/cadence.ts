import type { Contact } from '@/types';

/**
 * Per-relationship cadence: how often this pair actually talks.
 *
 * One number for everyone (45 silent days) misreads most relationships.
 * Contact is bursty and every pair has its own rhythm: a friend you write to
 * every three weeks is overdue at seven, while someone you ping twice a year
 * is not overdue at ninety days. Touches closer together than a week are one
 * conversation (a thread is not a rhythm); the gaps between conversations
 * are summarized as a log-normal (a median gap plus a log-space spread), and
 * "overdue" is the probability that a gap this long would already have
 * ended. Pairs with too little history borrow the user's own typical gap,
 * never earlier than the 45-day default, so cold start behaves like the old
 * rule.
 */

export interface CadenceEstimate {
  /** Median gap between conversations, in days. */
  typicalDays: number;
  /** Standard deviation of log(gap); wider means a less regular rhythm. */
  spread: number;
  /** Past gaps this pair contributed. Below MIN_PAIR_GAPS the estimate is the prior. */
  gaps: number;
  source: 'pair' | 'prior';
}

/** Gaps a pair needs before its own history outweighs the prior. */
export const MIN_PAIR_GAPS = 3;
/** Touches closer together than this are one conversation, not a rhythm. */
export const CONVERSATION_GAP_DAYS = 7;
/** Contacts with a rhythm of their own the user needs before their typical gap replaces the default. */
const MIN_PRIOR_CONTACTS = 10;
/** A perfectly regular pair still gets a curve, not a cliff. */
const MIN_SPREAD = 0.35;
const MAX_SPREAD = 1.6;
const DEFAULT_SPREAD = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinct days on which the pair touched, oldest first. Same-day interactions are one touch. */
export function touchDays(contact: Contact): number[] {
  const dates = contact.interactions?.length
    ? contact.interactions.map(i => i.date)
    : contact.sentDates ?? [];
  const days = new Set<number>();
  for (const date of dates) {
    const t = new Date(date).getTime();
    if (!isNaN(t)) days.add(Math.floor(t / DAY_MS));
  }
  return Array.from(days).sort((a, b) => a - b);
}

/** The days on which a conversation started: a touch more than a week after the previous one. */
export function conversationStarts(days: number[], gapDays = CONVERSATION_GAP_DAYS): number[] {
  const starts: number[] = [];
  for (let i = 0; i < days.length; i++) {
    if (i === 0 || days[i] - days[i - 1] > gapDays) starts.push(days[i]);
  }
  return starts;
}

/** Days between consecutive entries. */
export function gapsBetween(days: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  return gaps;
}

/** The gaps between this pair's conversations: the raw material of its rhythm. */
export function conversationGaps(days: number[]): number[] {
  return gapsBetween(conversationStarts(days));
}

function logStats(values: number[]): { mu: number; sigma: number } {
  const logs = values.map(v => Math.log(Math.max(1, v)));
  const mu = logs.reduce((sum, v) => sum + v, 0) / logs.length;
  const variance = logs.reduce((sum, v) => sum + (v - mu) ** 2, 0) / logs.length;
  return { mu, sigma: Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, Math.sqrt(variance))) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The user's own rhythm, one value per contact (that pair's median gap) so a
 * daily correspondent counts once, pooled: the prior a thin pair falls back
 * to. It is floored at `coldDays` so cold start matches the old rule (overdue
 * crosses one half at coldDays) and a heavy emailer's short average gap
 * cannot flood the queue with barely-known contacts.
 */
export function priorFromGaps(gapsPerContact: number[][], coldDays: number): CadenceEstimate {
  const medians = gapsPerContact.filter(gaps => gaps.length > 0).map(median);
  if (medians.length < MIN_PRIOR_CONTACTS) {
    return { typicalDays: coldDays, spread: DEFAULT_SPREAD, gaps: 0, source: 'prior' };
  }
  const { mu, sigma } = logStats(medians);
  return { typicalDays: Math.max(coldDays, Math.exp(mu)), spread: sigma, gaps: 0, source: 'prior' };
}

export function userPrior(contacts: Contact[], coldDays: number): CadenceEstimate {
  return priorFromGaps(
    contacts.filter(c => !c.isSpam).map(c => conversationGaps(touchDays(c))),
    coldDays
  );
}

/** This pair's cadence from its own gaps, or the prior when there are too few. */
export function estimateCadence(gaps: number[], prior: CadenceEstimate): CadenceEstimate {
  if (gaps.length < MIN_PAIR_GAPS) return { ...prior, gaps: gaps.length, source: 'prior' };
  const { mu, sigma } = logStats(gaps);
  return { typicalDays: Math.exp(mu), spread: sigma, gaps: gaps.length, source: 'pair' };
}

// Abramowitz and Stegun 7.1.26: accurate to about 1.5e-7, plenty for a ranking.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/**
 * How far the silence sits past the pair's typical gap, in spreads: 0 at the
 * typical gap, positive beyond it, unbounded, so it ranks where the
 * probability below would saturate at one.
 */
export function overdueZ(daysSince: number, cadence: CadenceEstimate): number {
  if (daysSince <= 0) return Number.NEGATIVE_INFINITY;
  return (Math.log(daysSince) - Math.log(cadence.typicalDays)) / cadence.spread;
}

/**
 * Probability that a gap drawn from this pair's own rhythm would already
 * have ended after `daysSince` days: one half at the typical gap, near one
 * well past it, near zero well before it.
 */
export function overdueProbability(daysSince: number, cadence: CadenceEstimate): number {
  if (daysSince <= 0) return 0;
  return 0.5 * (1 + erf(overdueZ(daysSince, cadence) / Math.SQRT2));
}
