import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import pLimit from 'p-limit';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rateLimit';
import { nameCircles } from '@/lib/circleNames';
import { semanticCircles, type SimilarityEdge } from '@/utils/semanticCircles';

/** The most recently contacted people seed the graph; each brings its nearest neighbours. */
const MAX_SEEDS = 60;
const NEIGHBOURS_PER_SEED = 5;

type NeighbourRow = { seed_email?: string; contact_email: string; similarity: number };

/** The vector migration (or the batch function) is not applied: nothing to call. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === '42883' || error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

/**
 * POST /api/circles/semantic: the circles implied by alike profiles, from
 * the embeddings already stored. One Postgres call for every seed's
 * neighbours where the batch function exists, one per seed where it does
 * not; names from the cache, else a handful of model calls, else the
 * heuristic. A missing vector migration is an empty list, not an error.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`semantic-circles:${owner}`, { limit: 4, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const [stored, groups] = await Promise.all([listContacts(owner), listGroups(owner)]);
    if (!stored.available || stored.contacts.length < 3) {
      return NextResponse.json({ circles: [] });
    }
    const seeds = stored.contacts
      .filter(c => !c.isSpam && c.lastContacted)
      .sort((a, b) => new Date(b.lastContacted).getTime() - new Date(a.lastContacted).getTime())
      .slice(0, MAX_SEEDS)
      .map(c => c.email.toLowerCase());
    if (seeds.length === 0) return NextResponse.json({ circles: [] });

    const supabase = getSupabaseAdmin();
    const edges: SimilarityEdge[] = [];
    const add = (seed: string, rows: NeighbourRow[] | null) => {
      for (const row of rows ?? []) edges.push({ a: seed, b: row.contact_email, similarity: Number(row.similarity) || 0 });
    };
    const batch = await supabase.rpc('similar_contacts_batch', { p_owner: owner, p_contacts: seeds, p_count: NEIGHBOURS_PER_SEED });
    if (!batch.error) {
      for (const row of (batch.data ?? []) as NeighbourRow[]) add(row.seed_email ?? '', [row]);
    } else if (!isMissingFunction(batch.error)) {
      console.error('Semantic circles batch lookup failed:', batch.error);
      return NextResponse.json({ error: 'Failed to find circles' }, { status: 500 });
    } else {
      const limit = pLimit(5);
      let missing = false;
      await Promise.all(
        seeds.map(seed =>
          limit(async () => {
            const { data, error } = await supabase.rpc('similar_contacts', { p_owner: owner, p_contact: seed, p_count: NEIGHBOURS_PER_SEED });
            if (error) {
              if (isMissingFunction(error)) missing = true;
              else console.error('Similar-contacts lookup failed for a seed:', error);
              return;
            }
            add(seed, data as NeighbourRow[] | null);
          })
        )
      );
      if (missing) return NextResponse.json({ circles: [] });
    }

    const circles = semanticCircles(edges, stored.contacts, groups.groups, { limit: 4 });
    const named = await nameCircles(owner, circles, stored.contacts);
    const response = NextResponse.json({ circles: named });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Semantic circles failed:', error);
    return NextResponse.json({ error: 'Failed to find circles' }, { status: 500 });
  }
}
