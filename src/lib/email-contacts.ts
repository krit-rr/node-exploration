/**
 * Shared contact-aggregation core for the provider mail clients.
 *
 * GmailClient and GraphClient each fetch the user's sent messages from their
 * provider and normalize them into SentMessage; everything after that —
 * dedupe by recipient, keep the latest date, accumulate bounded interaction
 * history, sort by recency — lives here exactly once.
 */

export interface EmailContact {
  emailAddress: {
    name?: string;
    address: string;
  };
}

export interface SentMessage {
  sentDateTime: string;
  recipients: EmailContact[];
  subject?: string;
  snippet?: string;
}

export interface ContactInteraction {
  date: string;
  channel: 'email';
  type: 'sent';
  subject?: string;
  snippet?: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  lastContacted: string;
  lastContactedRaw: string; // For sorting
  interactions?: ContactInteraction[];
}

// Bounded per contact so a frequent correspondent doesn't dominate the payload
const MAX_INTERACTIONS_PER_CONTACT = 20;

export function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

export function aggregateContactsByLatestInteraction(messages: SentMessage[]): Contact[] {
  const contactMap = new Map<string, Contact>();

  for (const message of messages) {
    if (!isValidDate(message.sentDateTime)) {
      console.warn(`Skipping message with invalid date: ${message.sentDateTime}`);
      continue;
    }
    const sentDate = new Date(message.sentDateTime);
    const isoDate = sentDate.toISOString();

    for (const recipient of message.recipients) {
      const emailAddress = recipient.emailAddress.address.toLowerCase();
      if (!emailAddress) continue; // Skip invalid email addresses
      const name = recipient.emailAddress.name || emailAddress;

      // If this contact doesn't exist in our map, or if this message is more
      // recent than the one we have stored, update the contact info
      const existing = contactMap.get(emailAddress);
      if (!existing || new Date(existing.lastContactedRaw) < sentDate) {
        contactMap.set(emailAddress, {
          id: emailAddress,
          name,
          email: emailAddress,
          lastContactedRaw: message.sentDateTime,
          lastContacted: isoDate,
          interactions: existing?.interactions ?? []
        });
      }

      const contact = contactMap.get(emailAddress)!;
      if ((contact.interactions?.length ?? 0) < MAX_INTERACTIONS_PER_CONTACT) {
        contact.interactions!.push({
          date: isoDate,
          channel: 'email',
          type: 'sent',
          subject: message.subject,
          snippet: message.snippet
        });
      }
    }
  }

  // Sort by latest contact date (descending)
  return Array.from(contactMap.values())
    .sort((a, b) => new Date(b.lastContactedRaw).getTime() - new Date(a.lastContactedRaw).getTime());
}
