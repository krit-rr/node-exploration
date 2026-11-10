import type { Contact } from '@/types';
import { assessCadence, isGoingCold, isPriorityContact, isSnoozed, lastTouchTime, PRIORITY_TAG, type CadenceAssessment } from '@/utils/reconnect';
import { MAX_INTERACTIONS } from '@/utils/interactions';

/**
 * The orbit map: every contact as a point around the user, distance being
 * how close the relationship actually is. Rings hold about 5, 15, 50 and
 * 150 people, the layer sizes found again and again in studies of personal
 * networks, so a ring filling up is a real constraint made visible rather
 * than a style choice. Closeness is a heuristic until the tie-strength
 * model exists: how recently and how often the pair talk, and how much
 * history they have. Rank decides the ring; the user's own intent (a drag)
 * is drawn beside it as a hollow marker and feeds the queue as priority.
 */

export type OrbitLayer = 1 | 2 | 3 | 4 | 5;

/** Cumulative ring capacities; everyone past the 150th sits in a faint band outside. */
export const LAYER_CAPACITY = [5, 15, 50, 150] as const;
export const LAYER_NAMES = ['closest 5', '15', '50', '150', 'beyond 150'] as const;

/** Outer edge of each layer as a share of the map radius; the fifth is the outer band. */
export const RING_EDGE = [0.22, 0.45, 0.7, 0.95, 1.08] as const;
const RING_INNER = 0.06;
const DAY_MS = 24 * 60 * 60 * 1000;

const RECENCY_HALF_LIFE_DAYS = 90;
export const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

/** The domain of a work address, or null for a consumer mailbox. */
export function workDomain(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain && !CONSUMER_DOMAINS.has(domain) ? domain : null;
}

export interface OrbitPoint {
  contact: Contact;
  email: string;
  layer: OrbitLayer;
  /** 0 at the user, 1 at the outer edge of the 150-ring, a little beyond for the band. */
  distance: number;
  /** Radians; colleagues share a wedge. */
  angle: number;
  /** 0 to 1, the heuristic behind the rank. */
  closeness: number;
  priority: boolean;
  goingCold: boolean;
  assessment: CadenceAssessment;
  /** Where the user put them, when that differs from where activity puts them. */
  intendedLayer?: 1 | 2 | 3 | 4;
  cluster: string;
}

export interface OrbitLayout {
  points: OrbitPoint[];
  /** How many people sit in each layer, 1 to 5. */
  counts: number[];
  total: number;
}

/** A small stable hash for angles and keys (djb2). */
export function hash(text: string): number {
  let h = 5381;
  for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

/** Colleagues cluster: the company, else a work domain, else the person alone. */
export function clusterKey(contact: Contact): string {
  const company = contact.company?.trim().toLowerCase();
  if (company) return `company:${company}`;
  const domain = workDomain(contact.email);
  if (domain) return `domain:${domain}`;
  return `person:${contact.email.toLowerCase()}`;
}

/**
 * Recency (half-life 90 days), frequency over the last year (monthly is
 * full marks) and depth of history, with a nudge for people the user
 * marked out. A heuristic, deliberately simple; the model replaces it.
 */
export function closenessScore(assessment: CadenceAssessment, priority: boolean): number {
  // Someone Node knows about but has never touched has no recency, whatever their row's age.
  const recency = assessment.neverTouched ? 0 : Math.pow(0.5, Math.max(0, assessment.daysSince) / RECENCY_HALF_LIFE_DAYS);
  const frequency = Math.min(1, assessment.touchesLastYear / 12);
  const depth = Math.min(1, Math.log(1 + assessment.touchCount) / Math.log(21));
  return Math.min(1, 0.5 * recency + 0.3 * frequency + 0.2 * depth + (priority ? 0.1 : 0));
}

/**
 * Priority as the rank sees it: the key-contact tag and group membership
 * only. Orbit intent is deliberately left out, so dragging someone inward
 * never moves the dot that shows where activity puts them.
 */
export function rankPriority(contact: Contact, priorityEmails?: Set<string>): boolean {
  if ((contact.tags ?? []).some(t => t.toLowerCase() === PRIORITY_TAG)) return true;
  return Boolean(priorityEmails?.has(contact.email.toLowerCase()));
}

/** The stored intent, when it is a valid ring. */
function intentOf(contact: Contact): 1 | 2 | 3 | 4 | undefined {
  const value = contact.intendedLayer;
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined;
}

export function layerForRank(rank: number): OrbitLayer {
  if (rank < LAYER_CAPACITY[0]) return 1;
  if (rank < LAYER_CAPACITY[1]) return 2;
  if (rank < LAYER_CAPACITY[2]) return 3;
  if (rank < LAYER_CAPACITY[3]) return 4;
  return 5;
}

/** Where a drop lands: a ring, or null past the 150-ring, meaning let activity place them. */
export function layerForDistance(distance: number): 1 | 2 | 3 | 4 | null {
  if (distance <= RING_EDGE[0]) return 1;
  if (distance <= RING_EDGE[1]) return 2;
  if (distance <= RING_EDGE[2]) return 3;
  if (distance <= RING_EDGE[3]) return 4;
  return null;
}

/** The middle of a ring, where an intended marker sits. */
export function ringDistance(layer: 1 | 2 | 3 | 4): number {
  const inner = layer === 1 ? RING_INNER : RING_EDGE[layer - 2];
  return (inner + RING_EDGE[layer - 1]) / 2;
}

type Timeline = {
  touches: { t: number; index: number }[];
  sent: { t: number; index: number }[];
  /** The oldest touch on record, or Infinity when there is none. */
  oldest: number;
  /** True when the row holds as many interactions as it can: there were more, older, that Node no longer has. */
  truncated: boolean;
};

const timelines = new WeakMap<Contact, Timeline>();

/** Dates parsed once per contact object; a drag of the slider asks fifty times. */
function timelineOf(contact: Contact): Timeline {
  const cached = timelines.get(contact);
  if (cached) return cached;
  const touches = (contact.interactions ?? [])
    .map((i, index) => ({ t: new Date(i.date).getTime(), index }))
    .filter(x => !Number.isNaN(x.t));
  const sent = (contact.sentDates ?? [])
    .map((d, index) => ({ t: new Date(d).getTime(), index }))
    .filter(x => !Number.isNaN(x.t));
  const timeline: Timeline = {
    touches,
    sent,
    oldest: Math.min(...touches.map(x => x.t), ...sent.map(x => x.t)),
    truncated: (contact.interactions?.length ?? 0) >= MAX_INTERACTIONS,
  };
  timelines.set(contact, timeline);
  return timeline;
}

export interface Replay {
  contacts: Contact[];
  /**
   * People whose stored history is full and starts after the moment: Node
   * cannot say where they sat then, so they are left out and counted rather
   * than drawn as strangers. These are usually the closest people.
   */
  beyondRecord: number;
}

/**
 * The contacts as they stood at `at`: only the touches up to then, the
 * last touch recomputed from them, nobody Node had not met yet, and no
 * present-day intent or snooze. With `computeOrbit(replay.contacts, { now:
 * at, replay: true })` the map replays where everyone sat at that moment,
 * so a year of drift can be scrubbed.
 */
export function contactsAsOf(contacts: Contact[], at: number): Replay {
  const projected: Contact[] = [];
  let beyondRecord = 0;
  for (const contact of contacts) {
    const line = timelineOf(contact);
    if (line.truncated && line.oldest > at) {
      beyondRecord += 1;
      continue;
    }
    const touches = line.touches.filter(x => x.t <= at);
    const sent = line.sent.filter(x => x.t <= at);
    let last = Math.max(-Infinity, ...touches.map(x => x.t), ...sent.map(x => x.t));
    if (last === -Infinity && line.touches.length === 0 && line.sent.length === 0) {
      // The only evidence is the date itself (an import with no message list): keep it when it is before the moment.
      const known = lastTouchTime(contact);
      if (known && !known.neverTouched && known.time <= at) last = known.time;
    }
    if (last === -Infinity) {
      // No touch yet at that time: present only if Node already knew them.
      const created = contact.createdAt ? new Date(contact.createdAt).getTime() : NaN;
      if (Number.isNaN(created) || created > at) continue;
    }
    projected.push({
      ...contact,
      interactions: touches.map(x => (contact.interactions ?? [])[x.index]),
      sentDates: sent.map(x => (contact.sentDates ?? [])[x.index]),
      lastContacted: last === -Infinity ? '' : new Date(last).toISOString(),
      snoozedUntil: undefined,
      // Where you want someone is a present-day mark; the replay shows activity only.
      intendedLayer: undefined,
    });
  }
  return { contacts: projected, beyondRecord };
}

/**
 * Who a new intent would push out of a full inner ring: the weakest person
 * already intended for it, by closeness. Only the inner two rings are
 * scarce; the 50 and the 150 are roomy. Saramäki et al. saw people make
 * this trade without noticing; here it is said out loud.
 */
export function displacedByIntent(layout: OrbitLayout, email: string, layer: 1 | 2 | 3 | 4): OrbitPoint | null {
  if (layer > 2) return null;
  const wanted = email.toLowerCase();
  const members = layout.points.filter(p => p.email !== wanted && intentOf(p.contact) === layer);
  if (members.length < LAYER_CAPACITY[layer - 1]) return null;
  return members.reduce((weakest, p) => (p.closeness < weakest.closeness ? p : weakest));
}

export interface OrbitMove {
  email: string;
  from: OrbitLayer;
  to: OrbitLayer;
  /** Where activity had them `days` ago, for a trail on the map. */
  fromDistance: number;
  angle: number;
}

/**
 * The ring moves of the last `days`, by activity alone: who slipped out, who
 * moved in, who arrived. Both layouts run in replay mode so a priority mark
 * cannot read as a move; someone beyond the record a week ago is simply not
 * compared.
 */
export function orbitMoves(contacts: Contact[], { days = 7, now = Date.now() }: { days?: number; now?: number } = {}): OrbitMove[] {
  const then = now - days * DAY_MS;
  const before = new Map(computeOrbit(contactsAsOf(contacts, then).contacts, { now: then, replay: true }).points.map(p => [p.email, p]));
  const moves: OrbitMove[] = [];
  for (const point of computeOrbit(contacts, { now, replay: true }).points) {
    const prior = before.get(point.email);
    if (!prior) {
      // Not on the map then: new this week, arriving from beyond, unless the
      // row's history is simply too short to say where they were.
      if (point.layer === 5 || point.assessment.neverTouched || (point.contact.interactions?.length ?? 0) >= MAX_INTERACTIONS) continue;
      moves.push({ email: point.email, from: 5, to: point.layer, fromDistance: RING_EDGE[4], angle: point.angle });
      continue;
    }
    if (prior.layer === point.layer) continue;
    moves.push({ email: point.email, from: prior.layer, to: point.layer, fromDistance: prior.distance, angle: point.angle });
  }
  // Slipping out first, the biggest jumps first.
  return moves.sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.email.localeCompare(b.email));
}

export function computeOrbit(
  contacts: Contact[],
  { priorityEmails, now = Date.now(), replay = false }: { priorityEmails?: Set<string>; now?: number; replay?: boolean } = {}
): OrbitLayout {
  const assessments = assessCadence(contacts, undefined, now);
  const scored: { contact: Contact; email: string; assessment: CadenceAssessment; priority: boolean; closeness: number }[] = [];
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    const assessment = assessments.get(email);
    if (!assessment) continue;
    // Tags and groups are today's marks too: a replayed layout ranks on activity alone.
    const priority = !replay && isPriorityContact(contact, priorityEmails);
    scored.push({ contact, email, assessment, priority, closeness: closenessScore(assessment, !replay && rankPriority(contact, priorityEmails)) });
  }
  scored.sort((a, b) => b.closeness - a.closeness || a.email.localeCompare(b.email));

  const counts = [0, 0, 0, 0, 0];
  const beyond = Math.max(1, scored.length - LAYER_CAPACITY[3]);
  const points = scored.map((s, rank) => {
    const layer = layerForRank(rank);
    counts[layer - 1] += 1;
    const start = layer === 1 ? 0 : LAYER_CAPACITY[layer - 2];
    const size = layer === 5 ? beyond : LAYER_CAPACITY[layer - 1] - start;
    const inner = layer === 1 ? RING_INNER : RING_EDGE[layer - 2];
    const outer = RING_EDGE[layer - 1];
    // The closest in a ring sit nearest its inner edge.
    const distance = inner + (outer - inner) * ((rank - start + 0.5) / size);
    const cluster = clusterKey(s.contact);
    const base = (hash(cluster) % 3600) / 3600 * 2 * Math.PI;
    const jitter = ((hash(s.email) % 240) / 240 - 0.5) * (Math.PI / 7.5);
    const intended = intentOf(s.contact);
    const intendedLayer = intended !== undefined && intended !== layer ? intended : undefined;
    return {
      contact: s.contact,
      email: s.email,
      layer,
      distance,
      angle: base + jitter,
      closeness: s.closeness,
      priority: s.priority,
      goingCold: isGoingCold(s.assessment) && !isSnoozed(s.contact, now),
      assessment: s.assessment,
      intendedLayer,
      cluster,
    };
  });
  return { points, counts, total: scored.length };
}
