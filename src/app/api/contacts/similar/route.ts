import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const MAX_LIMIT = 25;

/**
 * Contacts most similar to a given contact, by embedding distance.
 * Pure vector-to-vector comparison in Postgres: no model call.
 *
 * GET /api/contacts/similar?email=a@b.com&limit=10
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
    const email = searchParams.get('email')?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Missing or invalid email parameter' }, { status: 400 });
    }

    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') ?? '10', 10) || 10, 1),
      MAX_LIMIT
    );

    const { data, error } = await getSupabaseAdmin().rpc('similar_contacts', {
      p_owner: owner,
      p_contact: email,
      p_count: limit,
    });

    if (error) {
      console.error('Similar-contacts lookup failed:', error);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }

    const response = NextResponse.json({ results: data ?? [] });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Error in similar-contacts lookup:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
