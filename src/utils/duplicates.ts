import { Contact } from '@/types';

/**
 * Duplicate detection: the same person captured under two addresses (work
 * plus personal is the classic case for a power networker). Detection is
 * deliberately precise over clever; a false merge destroys a row, a missed
 * pair just stays two rows.
 */

export type DuplicatePair = {
  /** Suggested survivor: the row with more context wins. */
  primary: Contact;
  duplicate: Contact;
  reason: 'same name' | 'same email handle' | 'selected by you';
};

/** Pair two hand-picked contacts, suggesting the richer row as survivor. */
export function makePair(a: Contact, b: Contact): DuplicatePair {
  return toPair(a, b, 'selected by you');
}

/** Stable key for a pair regardless of order (dismissal bookkeeping). */
export function pairKey(a: Contact, b: Contact): string {
  return [a.email.toLowerCase(), b.email.toLowerCase()].sort().join('|');
}

const normalizeName = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Local parts that belong to roles, not people; never pair on these.
const GENERIC_LOCAL_PARTS = new Set([
  'info', 'hello', 'contact', 'admin', 'office', 'team', 'mail', 'support',
  'sales', 'hi', 'me', 'news', 'press', 'jobs', 'careers', 'hr', 'billing',
]);

/** How much a row knows; the richer row is the suggested survivor. */
function contextScore(contact: Contact): number {
  return (
    (contact.company ? 2 : 0) +
    (contact.notes?.trim() ? 2 : 0) +
    (contact.tags?.length ?? 0) +
    (contact.metAt ? 1 : 0) +
    (contact.introducedBy ? 1 : 0) +
    (contact.customFields?.length ?? 0) +
    Math.min(contact.interactions?.length ?? 0, 10) / 10
  );
}

function toPair(a: Contact, b: Contact, reason: DuplicatePair['reason']): DuplicatePair {
  const scoreA = contextScore(a);
  const scoreB = contextScore(b);
  let primary = a;
  let duplicate = b;
  if (scoreB > scoreA) {
    primary = b;
    duplicate = a;
  } else if (scoreB === scoreA) {
    // Tie: the more recently contacted address is the live one.
    const lastA = a.lastContacted ? new Date(a.lastContacted).getTime() : 0;
    const lastB = b.lastContacted ? new Date(b.lastContacted).getTime() : 0;
    if (lastB > lastA) {
      primary = b;
      duplicate = a;
    }
  }
  return { primary, duplicate, reason };
}

const MAX_PAIRS = 20;

/** Find likely same-person pairs among different email addresses. */
export function findDuplicatePairs(contacts: Contact[]): DuplicatePair[] {
  const candidates = contacts.filter((c) => !c.isSpam && c.email.includes('@'));

  const pairs: DuplicatePair[] = [];
  const seenPairs = new Set<string>();

  const addGroupPairs = (group: Contact[], reason: DuplicatePair['reason']) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = pairKey(group[i], group[j]);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        pairs.push(toPair(group[i], group[j], reason));
      }
    }
  };

  // Rule 1: identical full name (two or more words) on different addresses.
  // Single-token names ("John") are far too common to pair on.
  const byName = new Map<string, Contact[]>();
  for (const contact of candidates) {
    const name = normalizeName(contact.name ?? '');
    if (!name || !name.includes(' ')) continue;
    if (name === normalizeName(contact.email)) continue;
    const group = byName.get(name);
    if (group) group.push(contact);
    else byName.set(name, [contact]);
  }
  for (const group of byName.values()) {
    if (group.length > 1) addGroupPairs(group, 'same name');
  }

  // Rule 2: identical email handle on different domains (jane.doe@a.com and
  // jane.doe@b.io), skipping short or role-style handles.
  const byLocal = new Map<string, Contact[]>();
  for (const contact of candidates) {
    const local = contact.email.toLowerCase().split('@')[0];
    if (local.length < 4 || GENERIC_LOCAL_PARTS.has(local) || !/[a-z]/.test(local)) continue;
    const group = byLocal.get(local);
    if (group) group.push(contact);
    else byLocal.set(local, [contact]);
  }
  for (const group of byLocal.values()) {
    if (group.length > 1) addGroupPairs(group, 'same email handle');
  }

  return pairs.slice(0, MAX_PAIRS);
}
