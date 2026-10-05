import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { embedTexts } from '@/lib/embeddings';
import {
  contactEmbeddingText,
  interactionEmbeddingText,
  contentHash,
} from '@/utils/embeddingText';
import { Contact } from '@/types';
import { rateLimit } from '@/lib/rateLimit';

const MAX_CONTACTS_PER_SYNC = 2000;
const MAX_INTERACTIONS_PER_SYNC = 500;

/**
 * Upsert embeddings for the caller's contacts and their email interactions.
 *
 * The client posts its full contact list (the app's source of truth lives in
 * localStorage); we hash each contact's embedding text and only call the
 * embedding model for rows whose content actually changed, so a no-op sync
 * costs two SELECTs and zero model calls.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'You must be signed in to access this API' },
        { status: 401 }
      );
    }
    const owner = session.user.email.toLowerCase();

    // Embedding syncs are model-call heavy; a legitimate client needs at most
    // one per contacts refresh.
    const limited = rateLimit(`embed-sync:${owner}`, { limit: 6, windowMs: 60_000 });
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many sync requests, slow down' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
      );
    }

    let body: { contacts?: Contact[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const contacts = (Array.isArray(body.contacts) ? body.contacts : [])
      .filter(
        (c): c is Contact =>
          !!c && typeof c.email === 'string' && c.email.includes('@') && typeof c.name === 'string'
      )
      .slice(0, MAX_CONTACTS_PER_SYNC);

    if (contacts.length === 0) {
      return NextResponse.json({ error: 'No valid contacts provided' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // --- Contact embeddings ---
    const entriesByEmail = new Map<
      string,
      { contact_email: string; content: string; content_hash: string }
    >();
    for (const contact of contacts) {
      const contactEmail = contact.email.toLowerCase();
      if (entriesByEmail.has(contactEmail)) continue;
      const content = contactEmbeddingText(contact);
      entriesByEmail.set(contactEmail, {
        contact_email: contactEmail,
        content,
        content_hash: contentHash(content),
      });
    }
    const entries = Array.from(entriesByEmail.values());

    const { data: existingContacts, error: existingError } = await supabase
      .from('contact_embeddings')
      .select('contact_email, content_hash')
      .eq('owner_email', owner);
    if (existingError) {
      console.error('Failed to read existing contact embeddings:', existingError);
      return NextResponse.json({ error: 'Failed to read embeddings' }, { status: 500 });
    }

    const existingHashes = new Map(
      (existingContacts ?? []).map((row) => [row.contact_email, row.content_hash])
    );
    const changed = entries.filter(
      (entry) => existingHashes.get(entry.contact_email) !== entry.content_hash
    );

    if (changed.length > 0) {
      const vectors = await embedTexts(changed.map((entry) => entry.content));
      const rows = changed.map((entry, i) => ({
        owner_email: owner,
        ...entry,
        embedding: vectors[i],
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertError } = await supabase
        .from('contact_embeddings')
        .upsert(rows, { onConflict: 'owner_email,contact_email' });
      if (upsertError) {
        console.error('Failed to upsert contact embeddings:', upsertError);
        return NextResponse.json({ error: 'Failed to store embeddings' }, { status: 500 });
      }
    }

    // --- Interaction embeddings ---
    const interactionEntries: {
      contact_email: string;
      interaction_date: string | null;
      channel: string | null;
      content: string;
      content_hash: string;
    }[] = [];
    for (const contact of contacts) {
      for (const interaction of contact.interactions ?? []) {
        if (interactionEntries.length >= MAX_INTERACTIONS_PER_SYNC) break;
        const content = interactionEmbeddingText(interaction, contact);
        if (!content) continue;
        const date = new Date(interaction.date);
        interactionEntries.push({
          contact_email: contact.email.toLowerCase(),
          interaction_date: isNaN(date.getTime()) ? null : date.toISOString(),
          channel: interaction.channel ?? null,
          content,
          content_hash: contentHash(content),
        });
      }
    }

    let interactionsEmbedded = 0;
    if (interactionEntries.length > 0) {
      const { data: existingInteractions, error: interactionsError } = await supabase
        .from('interaction_embeddings')
        .select('content_hash')
        .eq('owner_email', owner);
      if (interactionsError) {
        console.error('Failed to read existing interaction embeddings:', interactionsError);
        return NextResponse.json({ error: 'Failed to read embeddings' }, { status: 500 });
      }

      const knownHashes = new Set((existingInteractions ?? []).map((row) => row.content_hash));
      const seenThisSync = new Set<string>();
      const newInteractions = interactionEntries.filter((entry) => {
        if (knownHashes.has(entry.content_hash) || seenThisSync.has(entry.content_hash)) {
          return false;
        }
        seenThisSync.add(entry.content_hash);
        return true;
      });

      if (newInteractions.length > 0) {
        const vectors = await embedTexts(newInteractions.map((entry) => entry.content));
        const rows = newInteractions.map((entry, i) => ({
          owner_email: owner,
          ...entry,
          embedding: vectors[i],
        }));
        const { error: insertError } = await supabase
          .from('interaction_embeddings')
          .upsert(rows, {
            onConflict: 'owner_email,contact_email,content_hash',
            ignoreDuplicates: true,
          });
        if (insertError) {
          console.error('Failed to insert interaction embeddings:', insertError);
          return NextResponse.json({ error: 'Failed to store embeddings' }, { status: 500 });
        }
        interactionsEmbedded = newInteractions.length;
      }
    }

    const response = NextResponse.json({
      contactsEmbedded: changed.length,
      contactsUnchanged: entries.length - changed.length,
      interactionsEmbedded,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Error syncing embeddings:', error);
    return NextResponse.json({ error: 'Failed to sync embeddings' }, { status: 500 });
  }
}
