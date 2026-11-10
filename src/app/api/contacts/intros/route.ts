import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import pLimit from 'p-limit';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rateLimit';
import { AUTOMATED_ADDRESS } from '@/utils/reconnect';
import { MAX_SILENCE_DAYS, suggestIntros, type SimilarPair } from '@/utils/intros';

/** The most recently contacted people seed the search; each brings its nearest neighbours. */
const MAX_SEEDS = 30;
const NEIGHBOURS_PER_SEED = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type NeighbourRow = { seed_email?: string; contact_email: string; similarity: number };

/** The vector migration (or the batch function) is not applied: nothing to call. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === '42883' || error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

/**
 * POST /api/contacts/intros: the introductions worth making, from the
 * embeddings already stored for the caller's contacts. Vector-to-vector
 * comparison in Postgres; no model call. One query for every seed where
 * the batch function exists, one query per seed where it does not yet, and
 * a seed that fails is left out rather than failing the rest.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`intros:${owner}`, { limit: 10, windowMs: 60_000 });
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
      .filter(c => now - new Date(c.lastContacted).getTime() <= MAX_SILENCE_DAYS * DAY_MS)
      .sort((a, b) => new Date(b.lastContacted).getTime() - new Date(a.lastContacted).getTime())
      .slice(0, MAX_SEEDS)
      .map(c => c.email.toLowerCase());
    if (seeds.length === 0) {
      return NextResponse.json({ intros: [] });
    }

    const supabase = getSupabaseAdmin();
    const pairs: SimilarPair[] = [];
    const add = (seed: string, rows: NeighbourRow[] | null) => {
      for (const row of rows ?? []) {
        pairs.push({ a: seed, b: row.contact_email, similarity: Number(row.similarity) || 0 });
      }
    };

    const batch = await supabase.rpc('similar_contacts_batch', { p_owner: owner, p_contacts: seeds, p_count: NEIGHBOURS_PER_SEED });
    if (!batch.error) {
      for (const row of (batch.data ?? []) as NeighbourRow[]) add(row.seed_email ?? '', [row]);
    } else if (!isMissingFunction(batch.error)) {
      console.error('Similar-contacts batch lookup failed:', batch.error);
      return NextResponse.json({ error: 'Failed to suggest intros' }, { status: 500 });
    } else {
      // Older database: one query per seed, five at a time.
      const limit = pLimit(5);
      let failed = 0;
      let missing = false;
      await Promise.all(
        seeds.map(seed =>
          limit(async () => {
            const { data, error } = await supabase.rpc('similar_contacts', { p_owner: owner, p_contact: seed, p_count: NEIGHBOURS_PER_SEED });
            if (error) {
              if (isMissingFunction(error)) missing = true;
              else {
                failed += 1;
                console.error('Similar-contacts lookup failed for a seed:', error);
              }
              return;
            }
            add(seed, data as NeighbourRow[] | null);
          })
        )
      );
      // No vector migration at all is the common case before setup: nothing to suggest, not an error.
      if (missing) return NextResponse.json({ intros: [] });
      if (failed === seeds.length) {
        return NextResponse.json({ error: 'Failed to suggest intros' }, { status: 500 });
      }
    }

    const intros = suggestIntros(stored.contacts, pairs, { limit: 10, now });
    const response = NextResponse.json({ intros });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Intro suggestions failed:', error);
    return NextResponse.json({ error: 'Failed to suggest intros' }, { status: 500 });
  }
}
