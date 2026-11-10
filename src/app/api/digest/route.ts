import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { buildDigest } from '@/lib/digest';
import { getDigestSubscription, setDigestSubscription } from '@/lib/digestStore';
import { rateLimit } from '@/lib/rateLimit';

/**
 * GET /api/digest: whether the signed-in user is subscribed and whether
 * sending is configured. `?format=html` renders the digest as it would be
 * sent today, from the stored contacts (the only ones a scheduler can see).
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
    const { searchParams } = new URL(request.url);
    if (searchParams.get('format') === 'html') {
      const [stored, groups] = await Promise.all([listContacts(owner), listGroups(owner)]);
      if (!stored.available) {
        return new Response('The digest is built from stored contacts; the contacts table is not set up yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
        });
      }
      const priorityEmails = new Set(groups.groups.flatMap((g) => g.members.map((m) => m.toLowerCase())));
      const digest = buildDigest({
        contacts: stored.contacts,
        priorityEmails,
        userName: session.user.name,
        appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL,
      });
      return new Response(digest.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
      });
    }

    const subscription = await getDigestSubscription(owner);
    const response = NextResponse.json({
      subscribed: subscription.enabled,
      persisted: subscription.available,
      configured: Boolean(process.env.RESEND_API_KEY && process.env.DIGEST_FROM),
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Digest read failed:', error);
    return NextResponse.json({ error: 'Failed to read the digest setting' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`digest-write:${owner}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

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
