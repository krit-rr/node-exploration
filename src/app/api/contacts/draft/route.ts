import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listContactsByEmail } from '@/lib/contactsStore';
import { draftOpener } from '@/lib/draft';
import { rateLimit } from '@/lib/rateLimit';
import { assessCadence } from '@/utils/reconnect';

/**
 * POST /api/contacts/draft: a short reconnect email for one contact, from
 * what Node knows about them. Written by the model when one is configured,
 * assembled from the same facts when not. The user edits before sending.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`draft:${owner}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many drafts, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const { email } = await request.json();
    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    const stored = await listContactsByEmail(owner, [email]);
    const contact = stored.contacts[0];
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const assessment = assessCadence([contact]).get(contact.email.toLowerCase());
    const last = contact.lastContacted ? new Date(contact.lastContacted).getTime() : NaN;
    const daysSince = assessment?.daysSince ?? (isNaN(last) ? 0 : Math.floor((Date.now() - last) / 86_400_000));
    const typicalDays = assessment?.cadence.source === 'pair' ? assessment.cadence.typicalDays : undefined;

    const draft = await draftOpener({
      contact,
      userName: session.user.name ?? '',
      daysSince,
      typicalDays,
    });
    return NextResponse.json(draft);
  } catch (error) {
    console.error('Draft failed:', error);
    return NextResponse.json({ error: 'Failed to write a draft' }, { status: 500 });
  }
}
