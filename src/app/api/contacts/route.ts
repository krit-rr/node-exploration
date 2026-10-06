import { NextRequest, NextResponse } from "next/server";
import { GraphClient } from "@/lib/graph-client";
import { GmailClient } from "@/lib/gmail-client";
import { getToken } from "next-auth/jwt";
import { Contact } from "@/types";
import { enrichBatchViaAI } from "@/utils/enrichBatchViaAI";
import { listContacts, mergeProviderContacts } from "@/lib/contactsStore";
import { rateLimit } from "@/lib/rateLimit";

type Provider = 'google' | 'microsoft-entra-id';

async function fetchProviderContacts(provider: Provider, accessToken: string): Promise<Contact[]> {
  const client = provider === 'google' ? new GmailClient(accessToken) : new GraphClient(accessToken);
  const contacts = await client.getUniqueContactsByLatestInteraction();

  return contacts.map(contact => ({
    id: contact.email, // store assigns the durable uuid on merge
    name: contact.name,
    email: contact.email,
    lastContacted: contact.lastContacted,
    sentDates: (contact.interactions ?? []).map(i => i.date),
    interactions: contact.interactions ?? [],
    provider
  }));
}

/**
 * GET /api/contacts        -> stored contacts (fast; auto-syncs when empty)
 * GET /api/contacts?sync=1 -> re-pull from the mail provider and MERGE into
 *                             the store (user edits and imports survive)
 *
 * Before the contacts migration is applied the store reports unavailable and
 * the route behaves like the old stateless version.
 */
export async function GET(request: NextRequest) {
  try {
    // The provider access token lives only in the httpOnly JWT cookie
    // (never on the client-visible session), so read it with getToken().
    const token = await getToken({ req: request });

    if (token?.error === 'RefreshTokenError') {
      return NextResponse.json(
        { error: "Session expired, please sign in again" },
        { status: 401 }
      );
    }
    if (!token?.accessToken || !token.email) {
      return NextResponse.json(
        { error: "You must be signed in to access this API" },
        { status: 401 }
      );
    }
    const provider = token.provider;
    if (provider !== 'google' && provider !== 'microsoft-entra-id') {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
    }
    const owner = token.email.toLowerCase();
    const forceSync = request.nextUrl.searchParams.get('sync') === '1';

    let stored: { available: boolean; contacts: Contact[] };
    try {
      stored = await listContacts(owner);
    } catch (error) {
      console.error("Contact store unavailable, falling back to stateless mode:", error);
      stored = { available: false, contacts: [] };
    }

    if (stored.available && !forceSync && stored.contacts.length > 0) {
      const response = NextResponse.json({ contacts: stored.contacts, persisted: true });
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }

    // Provider sync path: mailbox fetch + AI enrichment are expensive, so
    // cap how often one user can trigger them.
    const limited = rateLimit(`provider-sync:${owner}`, { limit: 10, windowMs: 60_000 });
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many sync requests, slow down' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
      );
    }

    const providerContacts = await fetchProviderContacts(provider, token.accessToken);
    const enrichedContacts = await enrichBatchViaAI(providerContacts, {
      delayMs: 200,
      maxRetries: 2,
      cacheByDomain: true,
    });

    let contacts: Contact[] = enrichedContacts;
    let persisted = false;
    if (stored.available) {
      try {
        const merge = await mergeProviderContacts(owner, provider, enrichedContacts);
        if (merge.available) {
          const merged = await listContacts(owner);
          if (merged.available) {
            contacts = merged.contacts;
            persisted = true;
          }
        }
      } catch (error) {
        console.error("Failed to persist provider contacts (serving unmerged):", error);
      }
    }

    const response = NextResponse.json({ contacts, persisted });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}
