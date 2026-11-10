import { Client } from "@microsoft/microsoft-graph-client";
import { isValidDate, type EmailContact, type SentMessage } from './email-contacts';

export type { Contact, ContactInteraction } from './email-contacts';

interface GraphMessage {
  sentDateTime: string;
  toRecipients?: EmailContact[];
  ccRecipients?: EmailContact[];
  bccRecipients?: EmailContact[];
  subject?: string;
  bodyPreview?: string;
}

export class GraphClient {
  private client: Client;

  constructor(accessToken: string) {
    this.client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  /** The newest `limit` sent messages, or with `before`, the newest ones older than that moment. */
  async getSentEmails({ limit = 100, before }: { limit?: number; before?: number } = {}): Promise<SentMessage[]> {
    let request = this.client.api('/me/mailFolders/sentItems/messages')
      .select('sentDateTime,toRecipients,ccRecipients,bccRecipients,subject,bodyPreview')
      .top(limit)
      .orderby('sentDateTime desc');
    // Graph wants the ordering property in the filter too; sentDateTime is both.
    if (before) request = request.filter(`sentDateTime lt ${new Date(before).toISOString()}`);
    const response = await request.get();

    return (response.value as GraphMessage[])
      .filter(message => isValidDate(message.sentDateTime))
      .map(message => ({
        sentDateTime: message.sentDateTime,
        internalTime: new Date(message.sentDateTime).getTime(),
        recipients: [
          ...(message.toRecipients ?? []),
          ...(message.ccRecipients ?? []),
          ...(message.bccRecipients ?? []),
        ],
        subject: message.subject || undefined,
        snippet: message.bodyPreview || undefined
      }));
  }
}
