import type { Contact } from '@/types';

type Interaction = NonNullable<Contact['interactions']>[number];

/** Interactions that carry any text (a subject or a preview), newest first. */
export function textInteractions(contact: Contact): Interaction[] {
  return [...(contact.interactions ?? [])]
    .filter(i => i.date && (i.subject?.trim() || i.snippet?.trim()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * True when there is text the stored memory has not read: nothing stored
 * yet, or a message with text newer than the last read. Compared as dates,
 * because interaction dates are days while the read time is a timestamp.
 * The server decides for real (by source hash); this only spares a request
 * that could not change anything.
 */
export function memoryIsStale(contact: Contact): boolean {
  const newest = textInteractions(contact)[0];
  if (!newest) return false;
  if (!contact.memory) return true;
  const readAt = new Date(contact.memory.updatedAt).getTime();
  return Number.isNaN(readAt) || new Date(newest.date).getTime() > readAt;
}
