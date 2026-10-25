import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listViews, replaceViews, type SavedView } from '@/lib/viewsStore';
import { rateLimit } from '@/lib/rateLimit';

const MAX_VIEWS = 50;

function isValidView(v: unknown): v is SavedView {
  const view = v as SavedView;
  return (
    !!view &&
    typeof view.id === 'string' && view.id.length > 0 && view.id.length <= 100 &&
    typeof view.name === 'string' && view.name.length > 0 && view.name.length <= 200 &&
    typeof view.config === 'object' && view.config !== null &&
    JSON.stringify(view.config).length <= 2000
  );
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await listViews(session.user.email.toLowerCase());
    const response = NextResponse.json({ views: result.views, persisted: result.available });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Failed to list views:', error);
    return NextResponse.json({ error: 'Failed to load views' }, { status: 500 });
  }
}

/** Replace-set the caller's saved views. */
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`views:${owner}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many view updates, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const { views } = await request.json();
    if (!Array.isArray(views) || views.length > MAX_VIEWS || !views.every(isValidView)) {
      return NextResponse.json({ error: 'Invalid views data' }, { status: 400 });
    }
    const result = await replaceViews(owner, views);
    return NextResponse.json({ persisted: result.available });
  } catch (error) {
    console.error('Failed to save views:', error);
    return NextResponse.json({ error: 'Failed to save views' }, { status: 500 });
  }
}
