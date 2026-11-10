import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listContactsByEmail, setRehearsal } from '@/lib/contactsStore';
import { rateLimit } from '@/lib/rateLimit';
import { nextEntry } from '@/utils/rehearsal';

/**
 * POST /api/contacts/rehearsal: the user answered a name card. The
 * schedule step is computed here from the stored entry, so a client
 * cannot push a card out by sending its own dates.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`rehearsal:${owner}`, { limit: 120, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many answers, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const { email, result } = await request.json();
    if (typeof email !== 'string' || !email.includes('@') || (result !== 'got' && result !== 'missed')) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    const stored = await listContactsByEmail(owner, [email]);
    if (!stored.available) {
      return NextResponse.json({ entry: nextEntry(undefined, result), persisted: false });
    }
    const contact = stored.contacts[0];
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const entry = nextEntry(contact.rehearsal, result);
    const saved = await setRehearsal(owner, email, entry);
    return NextResponse.json({ entry, persisted: saved.available });
  } catch (error) {
    console.error('Rehearsal answer failed:', error);
    return NextResponse.json({ error: 'Failed to record the answer' }, { status: 500 });
  }
}
