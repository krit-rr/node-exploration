import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setSpamFlags } from '@/lib/contactsStore';

const MAX_EMAILS = 500;

/** POST /api/contacts/spam — persist spam flags for a batch of contacts. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { emails, isSpam } = await request.json();
    if (!Array.isArray(emails) || emails.length === 0 || emails.length > MAX_EMAILS ||
        !emails.every((e) => typeof e === 'string') || typeof isSpam !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }

    try {
      const result = await setSpamFlags(session.user.email.toLowerCase(), emails, isSpam);
      return NextResponse.json({ persisted: result.available });
    } catch (error) {
      console.error('Failed to persist spam flags:', error);
      return NextResponse.json({ persisted: false });
    }
  } catch (error) {
    console.error('Error updating spam flags:', error);
    return NextResponse.json({ error: 'Failed to update spam flags' }, { status: 500 });
  }
}
