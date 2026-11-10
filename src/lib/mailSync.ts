import type { Contact } from '@/types';
import { GmailClient } from '@/lib/gmail-client';
import { GraphClient } from '@/lib/graph-client';
import { aggregateContactsByLatestInteraction, oldestMessageTime, type SentMessage } from '@/lib/email-contacts';
import type { SyncCursor } from '@/lib/syncStore';

/**
 * Deeper sync, a page at a time. The first sync reads the newest hundred
 * sent emails, which leaves the rhythm model, the orbit replay and circles
 * thin; each visit then walks a few pages further into the past and merges
 * what it finds. History is combined, never replaced, so nothing a page
 * brings back can undo a logged touch or a newer date.
 */

export type MailProvider = 'google' | 'microsoft-entra-id';

/** Messages per page: a hundred metadata reads is well inside Gmail's per-user quota. */
export const BACKFILL_PAGE = 100;
/** Two years is as far as the walk goes: older mail says little about who matters now. */
export const BACKFILL_HORIZON_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

export function providerClient(provider: MailProvider, accessToken: string): GmailClient | GraphClient {
  return provider === 'google' ? new GmailClient(accessToken) : new GraphClient(accessToken);
}

/** The contacts a page of sent mail implies, in the shape the store merges. */
export function contactsFromMessages(messages: SentMessage[], provider: MailProvider): Contact[] {
  return aggregateContactsByLatestInteraction(messages).map(contact => ({
    id: contact.email, // store assigns the durable uuid on merge
    name: contact.name,
    email: contact.email,
    lastContacted: contact.lastContacted,
    sentDates: (contact.interactions ?? []).map(i => i.date),
    interactions: contact.interactions ?? [],
    provider,
  }));
}

/**
 * Where the walk stands after a page. A short page is the end of the
 * mailbox; a page that reached past the horizon is far enough; a page that
 * made no progress (the provider ignored `before`) stops rather than loops.
 */
export function advanceCursor(previous: SyncCursor, fetched: SentMessage[], now = Date.now()): SyncCursor {
  const pages = previous.pages + 1;
  const messages = previous.messages + fetched.length;
  const oldest = oldestMessageTime(fetched);
  if (oldest === null) return { ...previous, pages, messages, done: true };
  const previousBefore = previous.beforeTime ? new Date(previous.beforeTime).getTime() : Infinity;
  if (oldest >= previousBefore) return { ...previous, pages, messages, done: true };
  const horizon = now - BACKFILL_HORIZON_DAYS * DAY_MS;
  return {
    beforeTime: new Date(oldest).toISOString(),
    pages,
    messages,
    done: fetched.length < BACKFILL_PAGE || oldest <= horizon,
  };
}
