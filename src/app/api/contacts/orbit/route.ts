import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setIntendedLayer } from '@/lib/contactsStore';
import { rateLimit } from '@/lib/rateLimit';

/**
 * POST /api/contacts/orbit: where the user wants a contact to sit, from a
 * drag on the orbit map. `layer` is 1 (the closest five) to 4 (the 150),
 * or null to let activity place them again.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`orbit:${owner}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many changes, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const { email, layer } = await request.json();
    const validLayer = layer === null || (Number.isInteger(layer) && layer >= 1 && layer <= 4);
    if (typeof email !== 'string' || !email.includes('@') || !validLayer) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    try {
      const result = await setIntendedLayer(owner, email, layer);
      if (result.available && !result.found) {
        return NextResponse.json({ persisted: false, reason: 'not-found' });
      }
      return NextResponse.json({ persisted: result.available });
    } catch (error) {
      console.error('Orbit persistence failed:', error);
      return NextResponse.json({ persisted: false });
    }
  } catch (error) {
    console.error('Error setting orbit:', error);
    return NextResponse.json({ error: 'Failed to set orbit' }, { status: 500 });
  }
}
