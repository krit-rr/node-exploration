import type { Contact } from '@/types';
import { firstKnown } from '@/utils/onThisDay';

/**
 * Place, time and introducer as indexes. `met_at`, the date Node first knew
 * someone and `introduced_by` exist as columns; here they become views:
 * where you met people, when, and who brought whom (three hops deep), so
 * the network reads as a map of your worlds rather than one flat list.
 */

export interface PlaceGroup {
  name: string;
  members: Set<string>;
  /** When the newest person from this place was first known, ms. */
  latest: number | null;
}

export interface MonthGroup {
  /** YYYY-MM */
  month: string;
  label: string;
  members: Set<string>;
}

export interface IntroducerChain {
  /** The introducer's display name, from the field as typed or the matched contact's name. */
  name: string;
  /** The introducer's own contact, when the name matched one. */
  contact?: Contact;
  /** People the introducer brought directly. */
  direct: Contact[];
  /** Everyone within three hops, nearest first, each with the hop count. */
  reach: { contact: Contact; hops: number }[];
}

export const MAX_HOPS = 3;

function key(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Where you met people: one group per met-at, the biggest first. */
export function places(contacts: Contact[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const contact of contacts) {
    const name = contact.metAt?.trim();
    if (!name || contact.isSpam) continue;
    const k = key(name);
    const group = groups.get(k) ?? { name, members: new Set<string>(), latest: null };
    group.members.add(contact.email.toLowerCase());
    const first = firstKnown(contact);
    if (first !== null && (group.latest === null || first > group.latest)) group.latest = first;
    groups.set(k, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.members.size - a.members.size || a.name.localeCompare(b.name));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** When you met people: one group per month Node first knew them, newest first. */
export function whenMet(contacts: Contact[], { limit = 12 }: { limit?: number } = {}): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const contact of contacts) {
    if (contact.isSpam) continue;
    const first = firstKnown(contact);
    if (first === null) continue;
    const date = new Date(first);
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const group = groups.get(month) ?? { month, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`, members: new Set<string>() };
    group.members.add(contact.email.toLowerCase());
    groups.set(month, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, limit);
}

/**
 * Who brought whom. The introducer field is free text, so it is matched to
 * a contact by full name (or address) and otherwise stands on its own; a
 * chain follows introductions up to three hops and never loops.
 */
export function introducerChains(contacts: Contact[]): IntroducerChain[] {
  const byName = new Map<string, Contact>();
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    if (contact.isSpam) continue;
    byEmail.set(contact.email.toLowerCase(), contact);
    if (contact.name && contact.name !== contact.email) byName.set(key(contact.name), contact);
  }
  const resolve = (text: string): Contact | undefined =>
    text.includes('@') ? byEmail.get(text.trim().toLowerCase()) : byName.get(key(text));

  // Edges: introducer key -> the people they brought.
  const brought = new Map<string, { name: string; contact?: Contact; direct: Contact[] }>();
  for (const contact of contacts) {
    const text = contact.introducedBy?.trim();
    if (!text || contact.isSpam) continue;
    const introducer = resolve(text);
    const k = introducer ? `contact:${introducer.email.toLowerCase()}` : `name:${key(text)}`;
    if (introducer && introducer.email.toLowerCase() === contact.email.toLowerCase()) continue;
    const entry = brought.get(k) ?? { name: introducer?.name ?? text, contact: introducer, direct: [] };
    entry.direct.push(contact);
    brought.set(k, entry);
  }

  const chains: IntroducerChain[] = [];
  for (const [k, entry] of brought) {
    const reach: { contact: Contact; hops: number }[] = [];
    const seen = new Set<string>([k]);
    let frontier = entry.direct;
    for (let hops = 1; hops <= MAX_HOPS && frontier.length > 0; hops++) {
      const next: Contact[] = [];
      for (const person of frontier) {
        const id = `contact:${person.email.toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        reach.push({ contact: person, hops });
        next.push(...(brought.get(id)?.direct ?? []));
      }
      frontier = next;
    }
    chains.push({ name: entry.name, contact: entry.contact, direct: entry.direct, reach });
  }
  return chains.sort((a, b) => b.reach.length - a.reach.length || a.name.localeCompare(b.name));
}
