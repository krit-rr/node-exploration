import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setSnooze } from '@/lib/contactsStore';

const MAX_SNOOZE_DAYS = 365;

/**
 * POST /api/contacts/reconnect — snooze a contact out of the reconnect
 * queue for N days (or clear the snooze with days: 0).
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, days } = await request.json();
    if (typeof email !== 'string' || !email.includes('@') ||
        typeof days !== 'number' || days < 0 || days > MAX_SNOOZE_DAYS) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }

    const until = days === 0
      ? null
      : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    try {
      const result = await setSnooze(session.user.email.toLowerCase(), email, until);
      return NextResponse.json({ snoozedUntil: until, persisted: result.available });
    } catch (error) {
      console.error('Snooze persistence failed:', error);
      return NextResponse.json({ snoozedUntil: until, persisted: false });
    }
  } catch (error) {
    console.error('Error snoozing contact:', error);
    return NextResponse.json({ error: 'Failed to snooze contact' }, { status: 500 });
  }
}
