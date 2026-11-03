import type { Contact } from '@/types';

/**
 * Circles: the groups a user already has without ever making one.
 *
 * Every sent email with several recipients puts those people together. Seen
 * often enough, the same set of people is a circle: the founders cc'd on
 * every intro, the dinner crowd, the deal team. This follows the implicit
 * social graph Google built for Gmail (Roth et al., KDD 2010): each
 * message's co-recipients form a group, weighted by recency with an
 * exponential decay, and a group that keeps recurring is suggested back to
 * the user. Nothing here calls a model; it is counting with a half-life.
 */

export interface CircleSuggestion {
  /** Stable across recomputation: a hash of the sorted member list. Dismissals hang on it. */
  key: string;
  name: string;
  /** Member emails, most recently contacted first. */
  members: string[];
  /** Recency-weighted count of the messages that put these people together. */
  weight: number;
  /** Distinct messages that contributed. */
  messages: number;
  /** When these people were last on one message together. */
  lastSeen: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A message from 90 days ago counts half as much as one from today. */
const HALF_LIFE_DAYS = 90;
/** A circle needs at least this many people, counting the contact whose history recorded it. */
const MIN_MEMBERS = 3;
/** A one-off thread is not a circle; the same people have to recur. */
const MIN_MESSAGES = 2;
/** Enough recent weight to be worth a card: two messages this quarter, or several older ones. */
const MIN_WEIGHT = 1.0;
/** Containment at which a smaller co-recipient set is a sub-thread of a bigger circle. */
const MERGE_CONTAINMENT = 0.6;
/** Jaccard overlap at which a suggestion is an existing group and must not be suggested again. */
const EXISTING_OVERLAP = 0.8;

const AUTOMATED_ADDRESS = /^(no-?reply|noreply|newsletter|notifications?|marketing|updates|info|support|hello)@/i;
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

function circleKey(members: string[]): string {
  // djb2 over the sorted member list: short, stable, never shown.
  let hash = 5381;
  for (const ch of members.join(',')) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const m of a) if (b.has(m)) n++;
  return n;
}

/** Share of the smaller set found in the larger: 1 when one contains the other. */
function containment(a: Set<string>, b: Set<string>): number {
  return shared(a, b) / Math.min(a.size, b.size);
}

/** Intersection over union: 1 only when the sets are identical. */
function jaccard(a: Set<string>, b: Set<string>): number {
  const common = shared(a, b);
  return common / (a.size + b.size - common);
}

function lastContactedTime(contact: Contact | undefined): number {
  const t = contact?.lastContacted ? new Date(contact.lastContacted).getTime() : 0;
  return isNaN(t) ? 0 : t;
}

function prettyDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A name the user will recognize: shared company, shared domain, shared event, else the people. */
function nameCircle(members: string[], byEmail: Map<string, Contact>): string {
  const people = members.map(m => byEmail.get(m)).filter((c): c is Contact => !!c);
  const companies = new Set(people.map(p => p.company?.trim()).filter((c): c is string => !!c));
  if (companies.size === 1 && people.length === members.length && people.every(p => p.company?.trim())) {
    return `${Array.from(companies)[0]} crowd`;
  }
  const domains = new Set(members.map(m => m.split('@')[1] ?? ''));
  const domain = Array.from(domains)[0];
  if (domains.size === 1 && domain && !CONSUMER_DOMAINS.has(domain)) return `${prettyDomain(domain)} people`;
  const events = new Set(people.map(p => p.metAt?.trim()).filter((e): e is string => !!e));
  if (events.size === 1 && people.length === members.length && people.every(p => p.metAt?.trim())) {
    return `${Array.from(events)[0]} crowd`;
  }
  const first = people.slice(0, 2).map(p => (p.name || p.email).split(' ')[0]);
  const rest = members.length - first.length;
  if (first.length === 0) return `${members.length} people`;
  return rest > 0 ? `${first.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}` : first.join(' and ');
}

/**
 * The circles implied by the contacts' interaction history, strongest first,
 * minus anything that is already one of the user's groups.
 */
export function suggestCircles(
  contacts: Contact[],
  existingGroups: { members: string[] }[],
  { limit = 4, now = Date.now() }: { limit?: number; now?: number } = {}
): CircleSuggestion[] {
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (contact.isSpam || AUTOMATED_ADDRESS.test(email)) continue;
    byEmail.set(email, contact);
  }

  type Bucket = { members: string[]; set: Set<string>; weight: number; messages: number; lastSeen: number };
  const buckets = new Map<string, Bucket>();
  const seenMessages = new Set<string>();

  for (const contact of byEmail.values()) {
    const self = contact.email.toLowerCase();
    for (const interaction of contact.interactions ?? []) {
      const others = interaction.participants;
      if (!others || others.length === 0) continue;
      const t = new Date(interaction.date).getTime();
      if (isNaN(t)) continue;
      const memberSet = new Set<string>([self]);
      for (const participant of others) {
        const email = participant.toLowerCase();
        if (byEmail.has(email)) memberSet.add(email);
      }
      if (memberSet.size < MIN_MEMBERS) continue;
      const members = Array.from(memberSet).sort();
      const groupKey = members.join(',');
      // The same message sits on every recipient's history; count it once.
      const messageKey = `${groupKey}|${interaction.date}`;
      if (seenMessages.has(messageKey)) continue;
      seenMessages.add(messageKey);
      const weight = Math.pow(0.5, Math.max(0, now - t) / DAY_MS / HALF_LIFE_DAYS);
      const bucket = buckets.get(groupKey);
      if (bucket) {
        bucket.weight += weight;
        bucket.messages += 1;
        bucket.lastSeen = Math.max(bucket.lastSeen, t);
      } else {
        buckets.set(groupKey, { members, set: memberSet, weight, messages: 1, lastSeen: t });
      }
    }
  }

  // A sub-thread of a circle is that circle: fold near-identical sets into
  // the strongest one, keeping the strongest one's members.
  const kept: Bucket[] = [];
  for (const bucket of Array.from(buckets.values()).sort((a, b) => b.weight - a.weight)) {
    const home = kept.find(k => containment(k.set, bucket.set) >= MERGE_CONTAINMENT);
    if (home) {
      home.weight += bucket.weight;
      home.messages += bucket.messages;
      home.lastSeen = Math.max(home.lastSeen, bucket.lastSeen);
    } else {
      kept.push(bucket);
    }
  }

  const existing = existingGroups.map(g => new Set(g.members.map(m => m.toLowerCase())));
  return kept
    .filter(b => b.messages >= MIN_MESSAGES && b.weight >= MIN_WEIGHT)
    .filter(b => !existing.some(g => jaccard(g, b.set) >= EXISTING_OVERLAP))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(b => {
      const members = [...b.members].sort(
        (x, y) => lastContactedTime(byEmail.get(y)) - lastContactedTime(byEmail.get(x))
      );
      return {
        key: circleKey(b.members),
        name: nameCircle(members, byEmail),
        members,
        weight: b.weight,
        messages: b.messages,
        lastSeen: new Date(b.lastSeen).toISOString(),
      };
    });
}

// Dismissals are per user and per browser: a circle the user said is not a
// circle stays gone on this device, and sign-out purges the key.
const DISMISSED_PREFIX = 'dismissed-circles_';

export function readDismissedCircles(userEmail: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${DISMISSED_PREFIX}${userEmail}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function dismissCircle(userEmail: string, key: string): Set<string> {
  const dismissed = readDismissedCircles(userEmail);
  dismissed.add(key);
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${userEmail}`, JSON.stringify(Array.from(dismissed)));
  } catch (error) {
    console.error('Failed to remember the dismissed circle:', error);
  }
  return dismissed;
}
