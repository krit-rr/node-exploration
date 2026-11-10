import type { Contact } from '@/types';

/** The newest subject line on this contact's history, if any. */
export function lastSubject(contact: Contact): string | undefined {
  return [...(contact.interactions ?? [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .find(i => i.subject?.trim())?.subject?.trim();
}
