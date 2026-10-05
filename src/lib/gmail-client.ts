import { gmail, auth } from '@googleapis/gmail';
import {
  aggregateContactsByLatestInteraction,
  isValidDate,
  type Contact,
  type EmailContact,
  type SentMessage,
} from './email-contacts';

export type { Contact, ContactInteraction } from './email-contacts';

export class GmailClient {
  private oauth2Client: InstanceType<typeof auth.OAuth2>;

  constructor(accessToken: string) {
    this.oauth2Client = new auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    this.oauth2Client.setCredentials({
      access_token: accessToken
    });
  }

  private parseEmailAddress(emailStr: string): EmailContact {
    // Improved regex to capture full quoted names with spaces
    const match = emailStr.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    let displayName = '';
    let email = '';
    if (match) {
      const name = match[1]?.trim();
      email = match[2]?.trim().toLowerCase() || '';
      // If name is present and not an email, use it; otherwise use the email
      if (name && !/^\S+@\S+\.\S+$/.test(name)) {
        displayName = name;
      } else {
        displayName = email;
      }
    } else {
      // Fallback for plain email addresses
      email = emailStr.replace(/"/g, '').trim().toLowerCase();
      displayName = email;
    }
    return {
      emailAddress: {
        name: displayName,
        address: email
      }
    };
  }

  async getSentEmails(limit: number = 100): Promise<SentMessage[]> {
    const client = gmail({ version: 'v1', auth: this.oauth2Client });
    const response = await client.users.messages.list({
      userId: 'me',
      q: 'in:sent',
      maxResults: limit
    });

    const messages = await Promise.all(
      (response.data.messages || []).map(async (message): Promise<SentMessage | null> => {
        const details = await client.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Bcc', 'Date', 'Subject']
        });

        const headers = details.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const dateStr = getHeader('Date');
        if (!isValidDate(dateStr)) {
          console.warn(`Invalid date format for message ${message.id}: ${dateStr}`);
          return null;
        }

        const recipients = ['To', 'Cc', 'Bcc'].flatMap(header =>
          getHeader(header).split(',').filter(Boolean).map(addr => this.parseEmailAddress(addr))
        );

        return {
          sentDateTime: dateStr,
          recipients,
          subject: getHeader('Subject') || undefined,
          // The snippet (first ~100 chars of the body) ships with the
          // metadata format, so capturing it costs no extra API call.
          snippet: details.data.snippet || undefined
        };
      })
    );

    return messages.filter((msg): msg is SentMessage => msg !== null);
  }

  async getUniqueContactsByLatestInteraction(): Promise<Contact[]> {
    return aggregateContactsByLatestInteraction(await this.getSentEmails());
  }
}
