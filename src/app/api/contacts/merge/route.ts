import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { mergeContacts } from '@/lib/contactsStore';
import { rateLimit } from '@/lib/rateLimit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/contacts/merge: fold a duplicate contact (same person, second
 * address) into the surviving primary row. Body:
 * { primaryEmail, duplicateEmail }. Returns the merged contact.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`merge:${owner}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many merge requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const body = await request.json();
    const primaryEmail =
      typeof body.primaryEmail === 'string' ? body.primaryEmail.trim().toLowerCase() : '';
    const duplicateEmail =
      typeof body.duplicateEmail === 'string' ? body.duplicateEmail.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(primaryEmail) || !EMAIL_RE.test(duplicateEmail)) {
      return NextResponse.json({ error: 'Two valid emails are required' }, { status: 400 });
    }
    if (primaryEmail === duplicateEmail) {
      return NextResponse.json({ error: 'Cannot merge a contact with itself' }, { status: 400 });
    }

    const result = await mergeContacts(owner, primaryEmail, duplicateEmail);
    if (!result.available) {
      return NextResponse.json(
        { error: 'Merging needs the latest database migration (alt_emails column)' },
        { status: 503 }
      );
    }
    if (!result.contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return NextResponse.json({ ...result.contact, persisted: true }, { status: 200 });
  } catch (error) {
    console.error('Error merging contacts:', error);
    return NextResponse.json({ error: 'Failed to merge contacts' }, { status: 500 });
  }
}
