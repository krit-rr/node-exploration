import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { buildDigest } from '@/lib/digest';
import { getDigestSubscription, setDigestSubscription } from '@/lib/digestStore';
import { rateLimit } from '@/lib/rateLimit';

/**
 * GET /api/digest: the signed-in user's digest as it would be sent today,
 * plus whether they are subscribed. `?format=html` renders it.
 * PUT /api/digest { enabled }: opt in to, or out of, the Monday email.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`digest-preview:${owner}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests, slow down' }, { status: 429 });
  }

  try {
    const [stored, groups, subscription] = await Promise.all([
      listContacts(owner),
      listGroups(owner),
      getDigestSubscription(owner),
    ]);
    const priorityEmails = new Set(groups.groups.flatMap((g) => g.members.map((m) => m.toLowerCase())));
    const digest = buildDigest({
      contacts: stored.contacts,
      priorityEmails,
      userName: session.user.name,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL,
    });

    const { searchParams } = new URL(request.url);
    if (searchParams.get('format') === 'html') {
      return new Response(digest.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
      });
    }
    const response = NextResponse.json({
      subject: digest.subject,
      text: digest.text,
      count: digest.count,
      subscribed: subscription.enabled,
      persisted: subscription.available,
      configured: Boolean(process.env.RESEND_API_KEY && process.env.DIGEST_FROM),
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Digest preview failed:', error);
    return NextResponse.json({ error: 'Failed to build the digest' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();
  try {
    const { enabled } = await request.json();
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    const result = await setDigestSubscription(owner, enabled);
    return NextResponse.json({ enabled, persisted: result.available });
  } catch (error) {
    console.error('Digest subscription failed:', error);
    return NextResponse.json({ error: 'Failed to save the digest setting' }, { status: 500 });
  }
}
