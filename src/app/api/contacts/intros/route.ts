import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import pLimit from 'p-limit';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rateLimit';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';
import { suggestIntros, type SimilarPair } from '@/utils/intros';

/** The most recently contacted people seed the search; each brings its nearest neighbours. */
const MAX_SEEDS = 30;
const NEIGHBOURS_PER_SEED = 5;
const MAX_SEED_SILENCE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/contacts/intros: the introductions worth making, from the
 * embeddings already stored for the caller's contacts. Vector-to-vector
 * comparison in Postgres; no model call.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`intros:${owner}`, { limit: 4, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const stored = await listContacts(owner);
    if (!stored.available || stored.contacts.length < 2) {
      return NextResponse.json({ intros: [] });
    }
    const now = Date.now();
    const seeds = stored.contacts
      .filter(c => !c.isSpam && !AUTOMATED_ADDRESS.test(c.email) && c.lastContacted)
      .filter(c => now - new Date(c.lastContacted).getTime() <= MAX_SEED_SILENCE_DAYS * DAY_MS)
      .sort((a, b) => new Date(b.lastContacted).getTime() - new Date(a.lastContacted).getTime())
      .slice(0, MAX_SEEDS);

    const supabase = getSupabaseAdmin();
    const limit = pLimit(5);
    const pairs: SimilarPair[] = [];
    await Promise.all(
      seeds.map(seed =>
        limit(async () => {
          const { data, error } = await supabase.rpc('similar_contacts', {
            p_owner: owner,
            p_contact: seed.email.toLowerCase(),
            p_count: NEIGHBOURS_PER_SEED,
          });
          if (error) throw new Error(error.message);
          for (const row of (data ?? []) as { contact_email: string; similarity: number }[]) {
            pairs.push({ a: seed.email.toLowerCase(), b: row.contact_email, similarity: Number(row.similarity) || 0 });
          }
        })
      )
    );

    const intros = suggestIntros(stored.contacts, pairs, { limit: 10, now });
    const response = NextResponse.json({ intros });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    // No embeddings yet (or no vector migration) is the common case: nothing to suggest.
    console.error('Intro suggestions failed:', error);
    return NextResponse.json({ intros: [] });
  }
}
