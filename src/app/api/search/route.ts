import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { embedText } from '@/lib/embeddings';

const MAX_LIMIT = 50;

/**
 * Semantic search over the caller's embedded contacts or interactions.
 *
 * GET /api/search?q=investors+in+healthcare
 *   -> { scope: 'contacts', results: [{ contact_email, content, similarity }] }
 *
 * GET /api/search?q=conference+talk&scope=interactions&contact=a@b.com
 *   -> interaction matches, optionally scoped to one contact, each with
 *      interaction_date and channel ("what did we last discuss?").
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'You must be signed in to access this API' },
        { status: 401 }
      );
    }
    const owner = session.user.email.toLowerCase();

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    if (!query) {
      return NextResponse.json({ error: 'Missing query parameter q' }, { status: 400 });
    }

    const scope = searchParams.get('scope') === 'interactions' ? 'interactions' : 'contacts';
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1),
      MAX_LIMIT
    );
    const contact = searchParams.get('contact')?.toLowerCase() || null;

    const queryEmbedding = await embedText(query);
    const supabase = getSupabaseAdmin();

    const { data, error } =
      scope === 'contacts'
        ? await supabase.rpc('match_contacts', {
            p_owner: owner,
            p_query: queryEmbedding,
            p_count: limit,
            p_min_similarity: 0.15,
          })
        : await supabase.rpc('match_interactions', {
            p_owner: owner,
            p_query: queryEmbedding,
            p_contact: contact,
            p_count: limit,
            p_min_similarity: 0.15,
          });

    if (error) {
      console.error('Semantic search failed:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    const response = NextResponse.json({ scope, results: data ?? [] });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Error in semantic search:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
