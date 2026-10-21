import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logTouch } from '@/lib/contactsStore';

const CHANNELS = ['email', 'call', 'meeting', 'other'] as const;
type Channel = (typeof CHANNELS)[number];

/**
 * POST /api/contacts/touch: record that the user reached out (by any
 * channel), bumping recency so the reconnect queue clears by ACTING,
 * not just by snoozing.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, channel, note } = await request.json();
    if (
      typeof email !== 'string' || !email.includes('@') ||
      !CHANNELS.includes(channel as Channel) ||
      (note !== undefined && typeof note !== 'string')
    ) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }

    try {
      const result = await logTouch(session.user.email.toLowerCase(), email, channel as Channel, note);
      if (result.available && result.contact) {
        return NextResponse.json({ persisted: true, contact: result.contact });
      }
      return NextResponse.json({ persisted: false });
    } catch (error) {
      console.error('Touch persistence failed:', error);
      return NextResponse.json({ persisted: false });
    }
  } catch (error) {
    console.error('Error logging touch:', error);
    return NextResponse.json({ error: 'Failed to log touch' }, { status: 500 });
  }
}
