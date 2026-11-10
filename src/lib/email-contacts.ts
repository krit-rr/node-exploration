/**
 * Shared contact-aggregation core for the provider mail clients.
 *
 * GmailClient and GraphClient each fetch the user's sent messages from their
 * provider and normalize them into SentMessage; everything after that , 
 * dedupe by recipient, keep the latest date, accumulate bounded interaction
 * history, sort by recency: lives here exactly once.
 */

export interface EmailContact {
  emailAddress: {
    name?: string;
    address: string;
  };
}

export interface SentMessage {
  sentDateTime: string;
  /** To and Cc: the people who could see each other on the message. */
  recipients: EmailContact[];
  /** Bcc: contacts like any other, but never recorded as anyone's co-recipient, and nobody is recorded as theirs. */
  bccRecipients?: EmailContact[];
  subject?: string;
  snippet?: string;
}

export interface ContactInteraction {
  date: string;
  channel: 'email';
  type: 'sent';
  subject?: string;
  snippet?: string;
  /** The other recipients of the same message, when it went to a small group. */
  participants?: string[];
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

// A circle is three people counting the contact whose row records it, so
// co-recipients are kept from three visible addresses up. A message to more
// people than MAX_GROUP_RECIPIENTS is a broadcast, not a circle: its
// co-recipients say nothing about who belongs together, so none are kept.
const MIN_GROUP_RECIPIENTS = 3;
const MAX_GROUP_RECIPIENTS = 20;

/** Lower-cased, well-formed, each address once: an address in both To and Cc is one recipient. */
function normalizeRecipients(list: EmailContact[] | undefined, except: Set<string> = new Set()): EmailContact[] {
  const seen = new Set<string>(except);
  const out: EmailContact[] = [];
  for (const recipient of list ?? []) {
    const address = recipient.emailAddress.address.toLowerCase();
    // Skip malformed addresses (e.g. header fragments without an @) so they
    // can't become phantom contacts
    if (!address.includes('@') || seen.has(address)) continue;
    seen.add(address);
    out.push({ emailAddress: { name: recipient.emailAddress.name, address } });
  }
  return out;
}

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

    // Who else was on this message: the raw material for circles. Only the
    // visible recipients count, and only when there are enough of them.
    const visible = normalizeRecipients(message.recipients);
    const hidden = normalizeRecipients(message.bccRecipients, new Set(visible.map(r => r.emailAddress.address)));
    const addresses = visible.map(r => r.emailAddress.address);
    const groupMessage = addresses.length >= MIN_GROUP_RECIPIENTS && addresses.length <= MAX_GROUP_RECIPIENTS;

    for (const recipient of [...visible, ...hidden]) {
      const emailAddress = recipient.emailAddress.address;
      const wasHidden = !addresses.includes(emailAddress);
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
          snippet: message.snippet,
          ...(groupMessage && !wasHidden ? { participants: addresses.filter(address => address !== emailAddress) } : {}),
        });
      }
    }
  }

  // Sort by latest contact date (descending)
  return Array.from(contactMap.values())
    .sort((a, b) => new Date(b.lastContactedRaw).getTime() - new Date(a.lastContactedRaw).getTime());
}
