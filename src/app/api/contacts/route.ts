import { NextRequest, NextResponse } from "next/server";
import { GraphClient } from "@/lib/graph-client";
import { GmailClient } from "@/lib/gmail-client";
import { getToken } from "next-auth/jwt";
import { Contact } from "@/types";
import { enrichBatchViaAI } from "@/utils/enrichBatchViaAI";

export async function GET(request: NextRequest) {
  try {
    // The provider access token lives only in the httpOnly JWT cookie
    // (never on the client-visible session), so read it with getToken().
    const token = await getToken({ req: request });

    if (!token?.accessToken) {
      return NextResponse.json(
        { error: "You must be signed in to access this API" },
        { status: 401 }
      );
    }

    let contacts: Contact[];
    
    // Use the appropriate client based on the provider
    if (token.provider === 'google') {
      const gmailClient = new GmailClient(token.accessToken);
      contacts = await gmailClient.getUniqueContactsByLatestInteraction();
    } else if (token.provider === 'microsoft-entra-id') {
      const graphClient = new GraphClient(token.accessToken);
      contacts = await graphClient.getUniqueContactsByLatestInteraction();
    } else {
      return NextResponse.json(
        { error: "Unsupported provider" },
        { status: 400 }
      );
    }
    
    if (!Array.isArray(contacts)) {
      console.error("Contacts is not an array:", contacts);
      return NextResponse.json(
        { error: "Invalid contacts data" },
        { status: 500 }
      );
    }
    
    // Transform contacts to match the expected format
    const transformedContacts: Contact[] = contacts.map(contact => {
      const transformed = {
        id: contact.email, // Use email as ID
        name: contact.name,
        email: contact.email,
        lastContacted: contact.lastContacted,
        sentDates: contact.lastContactedRaw ? [contact.lastContactedRaw] : [], // Add sentDates array
        // Gmail supplies per-message interactions with subject/snippet (used
        // for semantic interaction search); Graph still yields one bare entry.
        interactions: contact.interactions?.length ? contact.interactions : (contact.lastContactedRaw ? [{
          date: contact.lastContactedRaw,
          channel: 'email' as const,
          type: 'sent' as const
        }] : []),
        provider: token.provider as 'google' | 'microsoft-entra-id'
      };
      
      return transformed;
    });

    // Enrich contacts with AI
    const enrichedContacts = await enrichBatchViaAI(transformedContacts, {
      delayMs: 200, // 200ms delay between API calls
      maxRetries: 2, // Retry failed enrichments twice
      cacheByDomain: true, // Cache results by domain to avoid duplicate API calls
    });

    // This response is per-user and carries private data: it must never be
    // stored by a shared cache (CDN/proxy). Client-side caching is handled
    // in localStorage by the contacts page.
    const response = NextResponse.json({ contacts: enrichedContacts });
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