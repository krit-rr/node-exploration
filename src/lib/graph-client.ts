import { Client } from "@microsoft/microsoft-graph-client";
import {
  aggregateContactsByLatestInteraction,
  isValidDate,
  type Contact,
  type EmailContact,
  type SentMessage,
} from './email-contacts';

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

  async getSentEmails(limit: number = 100): Promise<SentMessage[]> {
    const response = await this.client.api('/me/mailFolders/sentItems/messages')
      .select('sentDateTime,toRecipients,ccRecipients,bccRecipients,subject,bodyPreview')
      .top(limit)
      .orderby('sentDateTime desc')
      .get();

    return (response.value as GraphMessage[])
      .filter(message => isValidDate(message.sentDateTime))
      .map(message => ({
        sentDateTime: message.sentDateTime,
        recipients: [
          ...(message.toRecipients ?? []),
          ...(message.ccRecipients ?? []),
          ...(message.bccRecipients ?? []),
        ],
        subject: message.subject || undefined,
        snippet: message.bodyPreview || undefined
      }));
  }

  async getUniqueContactsByLatestInteraction(): Promise<Contact[]> {
    return aggregateContactsByLatestInteraction(await this.getSentEmails());
  }
}
