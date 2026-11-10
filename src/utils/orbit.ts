import type { Contact } from '@/types';
import { assessCadence, isGoingCold, isPriorityContact, isSnoozed, type CadenceAssessment } from '@/utils/reconnect';

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
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

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

function hash(text: string): number {
  let h = 5381;
  for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

/** Colleagues cluster: the company, else a work domain, else the person alone. */
export function clusterKey(contact: Contact): string {
  const company = contact.company?.trim().toLowerCase();
  if (company) return `company:${company}`;
  const domain = contact.email.split('@')[1]?.toLowerCase() ?? '';
  if (domain && !CONSUMER_DOMAINS.has(domain)) return `domain:${domain}`;
  return `person:${contact.email.toLowerCase()}`;
}

/**
 * Recency (half-life 90 days), frequency over the last year (monthly is
 * full marks) and depth of history, with a nudge for people the user
 * marked out. A heuristic, deliberately simple; the model replaces it.
 */
export function closenessScore(contact: Contact, assessment: CadenceAssessment, priority: boolean, now: number): number {
  const recency = Math.pow(0.5, Math.max(0, assessment.daysSince) / RECENCY_HALF_LIFE_DAYS);
  const dates = contact.interactions?.length
    ? contact.interactions.map(i => i.date)
    : contact.sentDates ?? [];
  let lastYear = 0;
  for (const date of dates) {
    const t = new Date(date).getTime();
    if (!isNaN(t) && now - t <= 365 * DAY_MS) lastYear++;
  }
  const frequency = Math.min(1, lastYear / 12);
  const depth = Math.min(1, Math.log(1 + dates.length) / Math.log(21));
  return Math.min(1, 0.5 * recency + 0.3 * frequency + 0.2 * depth + (priority ? 0.1 : 0));
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

export function computeOrbit(
  contacts: Contact[],
  { priorityEmails, now = Date.now() }: { priorityEmails?: Set<string>; now?: number } = {}
): OrbitLayout {
  const assessments = assessCadence(contacts, undefined, now);
  const scored: { contact: Contact; email: string; assessment: CadenceAssessment; priority: boolean; closeness: number }[] = [];
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    const assessment = assessments.get(email);
    if (!assessment) continue;
    const priority = isPriorityContact(contact, priorityEmails);
    scored.push({ contact, email, assessment, priority, closeness: closenessScore(contact, assessment, priority, now) });
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
