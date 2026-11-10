import type { Contact } from '@/types';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';

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
  /** A hash of the sorted member list, for rendering; dismissals hang on the members themselves. */
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
/** Share of a weaker set that sits inside a stronger circle for it to count as that circle's sub-thread. */
const MERGE_CONTAINMENT = 0.6;
/** Share of a circle already inside one existing group for it to be that group, and not suggested again. */
const EXISTING_OVERLAP = 0.8;
/** Jaccard overlap at which a circle is one the user already dismissed, whichever members drift in or out. */
const DISMISSED_OVERLAP = 0.6;
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

/** Share of `part` found inside `whole`: 1 when the whole contains every member of the part. */
function containedIn(part: Set<string>, whole: Set<string>): number {
  return part.size === 0 ? 0 : shared(part, whole) / part.size;
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
  { limit = 4, now = Date.now(), dismissed = [] }: { limit?: number; now?: number; dismissed?: string[][] } = {}
): CircleSuggestion[] {
  // Every address a contact answers to maps to that contact, so a merged
  // duplicate's old address lands in the same circle as its row.
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (contact.isSpam || AUTOMATED_ADDRESS.test(email)) continue;
    byEmail.set(email, contact);
    for (const alt of contact.altEmails ?? []) {
      const altEmail = alt.toLowerCase();
      if (altEmail.includes('@') && !byEmail.has(altEmail)) byEmail.set(altEmail, contact);
    }
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
        const member = byEmail.get(participant.toLowerCase());
        if (member) memberSet.add(member.email.toLowerCase());
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

  // A sub-thread of a circle is that circle: fold a weaker set that sits
  // mostly inside a stronger one into it, keeping the stronger one's
  // members. A bigger set that merely shares a couple of people stays apart.
  const kept: Bucket[] = [];
  for (const bucket of Array.from(buckets.values()).sort((a, b) => b.weight - a.weight)) {
    const home = kept.find(k => containedIn(bucket.set, k.set) >= MERGE_CONTAINMENT);
    if (home) {
      home.weight += bucket.weight;
      home.messages += bucket.messages;
      home.lastSeen = Math.max(home.lastSeen, bucket.lastSeen);
    } else {
      kept.push(bucket);
    }
  }

  const existing = existingGroups.map(g => new Set(g.members.map(m => m.toLowerCase())));
  const gone = dismissed.map(members => new Set(members.map(m => m.toLowerCase())));
  return kept
    .filter(b => b.messages >= MIN_MESSAGES && b.weight >= MIN_WEIGHT)
    // Already a group (or a part of one): nothing to suggest.
    .filter(b => !existing.some(g => containedIn(b.set, g) >= EXISTING_OVERLAP))
    // Dismissed before, give or take a member: still dismissed, and the next circle takes the slot.
    .filter(b => !gone.some(d => jaccard(d, b.set) >= DISMISSED_OVERLAP))
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
// circle stays gone on this device, and sign-out purges the key. What is
// kept is the member list, so the circle stays gone when the people on it
// shift a little, not a hash that changes with them.
const DISMISSED_PREFIX = 'dismissed-circles_';

export function readDismissedCircles(userEmail: string): string[][] {
  try {
    const raw = localStorage.getItem(`${DISMISSED_PREFIX}${userEmail}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is unknown[] => Array.isArray(entry))
      .map(entry => entry.filter((m): m is string => typeof m === 'string').map(m => m.toLowerCase()))
      .filter(entry => entry.length > 0);
  } catch {
    return [];
  }
}

export function dismissCircle(userEmail: string, members: string[]): string[][] {
  const dismissed = readDismissedCircles(userEmail);
  dismissed.push(members.map(m => m.toLowerCase()).sort());
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${userEmail}`, JSON.stringify(dismissed));
  } catch (error) {
    console.error('Failed to remember the dismissed circle:', error);
  }
  return dismissed;
}
