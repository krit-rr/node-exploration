import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteRoster, getRoster, listRosters, saveRoster } from '@/lib/rosterStore';
import { rateLimit } from '@/lib/rateLimit';
import { MAX_EVENT_NAME, MAX_ROSTER, normalizeRosterEntries } from '@/utils/roster';

/**
 * Event rosters.
 * GET /api/rosters            -> every roster: event, how many left, when it changed
 * GET /api/rosters?event=X    -> one roster's entries
 * PUT /api/rosters { event, entries } -> save (or replace) a roster
 * DELETE /api/rosters { event }       -> drop one
 * Before the rosters migration every call reports persisted: false.
 */
async function owner(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ? session.user.email.toLowerCase() : null;
}

function eventName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_NAME) : '';
}

export async function GET(request: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const event = eventName(new URL(request.url).searchParams.get('event'));
    if (event) {
      const roster = await getRoster(who, event);
      return NextResponse.json({ persisted: roster.available, event, entries: roster.entries ?? [] });
    }
    const rosters = await listRosters(who);
    const response = NextResponse.json({ persisted: rosters.available, rosters: rosters.rosters });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Roster read failed:', error);
    return NextResponse.json({ error: 'Failed to read rosters' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = rateLimit(`rosters:${who}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests, slow down' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } });
  }
  try {
    const body = await request.json().catch(() => null);
    const event = eventName(body?.event);
    if (!event || !Array.isArray(body?.entries) || body.entries.length > MAX_ROSTER) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    const entries = normalizeRosterEntries(body.entries);
    const saved = await saveRoster(who, event, entries);
    return NextResponse.json({ persisted: saved.available, event, count: entries.length });
  } catch (error) {
    console.error('Roster save failed:', error);
    return NextResponse.json({ error: 'Failed to save the roster' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const event = eventName(body?.event);
    if (!event) return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    const result = await deleteRoster(who, event);
    return NextResponse.json({ persisted: result.available, event });
  } catch (error) {
    console.error('Roster delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete the roster' }, { status: 500 });
  }
}
