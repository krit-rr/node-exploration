import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listGroups, replaceGroups, type StoredGroup } from '@/lib/groupsStore';
import { rateLimit } from '@/lib/rateLimit';

const MAX_GROUPS = 200;
const MAX_MEMBERS_TOTAL = 10_000;

function isValidGroup(g: unknown): g is StoredGroup {
  const group = g as StoredGroup;
  return (
    !!group &&
    typeof group.id === 'string' && group.id.length > 0 && group.id.length <= 100 &&
    typeof group.name === 'string' && group.name.length > 0 && group.name.length <= 200 &&
    Array.isArray(group.members) && group.members.every((m) => typeof m === 'string' && m.length <= 320)
  );
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await listGroups(session.user.email.toLowerCase());
    const response = NextResponse.json({ groups: result.groups, persisted: result.available });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Failed to list groups:', error);
    return NextResponse.json({ error: 'Failed to load groups' }, { status: 500 });
  }
}

/** Replace-set the caller's groups (the client saves the whole array). */
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`groups:${owner}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many group updates, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const { groups } = await request.json();
    if (
      !Array.isArray(groups) ||
      groups.length > MAX_GROUPS ||
      !groups.every(isValidGroup) ||
      groups.reduce((n: number, g: StoredGroup) => n + g.members.length, 0) > MAX_MEMBERS_TOTAL
    ) {
      return NextResponse.json({ error: 'Invalid groups data' }, { status: 400 });
    }

    const result = await replaceGroups(owner, groups);
    return NextResponse.json({ persisted: result.available });
  } catch (error) {
    console.error('Failed to save groups:', error);
    return NextResponse.json({ error: 'Failed to save groups' }, { status: 500 });
  }
}
