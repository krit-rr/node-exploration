import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { mergeProviderContacts } from '@/lib/contactsStore';
import { rateLimit } from '@/lib/rateLimit';
import { advanceCursor, BACKFILL_PAGE, contactsFromMessages, providerClient, type MailProvider } from '@/lib/mailSync';
import { EMPTY_SYNC_CURSOR, getSyncCursor, saveSyncCursor } from '@/lib/syncStore';

/**
 * POST /api/contacts/backfill: read one more page of older sent mail and
 * merge it into the store; the cursor remembers where to continue. The
 * contacts page calls it a few times per visit until the walk is done.
 * GET /api/contacts/backfill: how far back the history reaches.
 */
async function identify(request: NextRequest) {
  const token = await getToken({ req: request });
  if (token?.error === 'RefreshTokenError') return { error: NextResponse.json({ error: 'Session expired, please sign in again' }, { status: 401 }) };
  if (!token?.email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const owner = token.email.toLowerCase();
  const provider = token.provider;
  if (provider !== 'google' && provider !== 'microsoft-entra-id') {
    // A demo session has no mailbox to walk.
    return { owner, provider: null, accessToken: null };
  }
  return { owner, provider: provider as MailProvider, accessToken: token.accessToken ?? null };
}

export async function GET(request: NextRequest) {
  const who = await identify(request);
  if ('error' in who) return who.error;
  if (!who.provider) return NextResponse.json({ persisted: false, cursor: null });
  try {
    const state = await getSyncCursor(who.owner, who.provider);
    const response = NextResponse.json({ persisted: state.available, cursor: state.cursor });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Backfill status failed:', error);
    return NextResponse.json({ error: 'Failed to read the sync state' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const who = await identify(request);
  if ('error' in who) return who.error;
  if (!who.provider || !who.accessToken) return NextResponse.json({ persisted: false, done: true, messages: 0 });

  // A visit reads a few pages; a hundred metadata reads each is the real cost.
  const limited = rateLimit(`backfill:${who.owner}`, { limit: 6, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many backfill requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const state = await getSyncCursor(who.owner, who.provider);
    if (!state.available) return NextResponse.json({ persisted: false, done: true, messages: 0 });
    const previous = state.cursor ?? EMPTY_SYNC_CURSOR;
    if (previous.done) {
      return NextResponse.json({ persisted: true, done: true, messages: 0, total: previous.messages, oldest: previous.beforeTime });
    }

    const before = previous.beforeTime ? new Date(previous.beforeTime).getTime() : undefined;
    const messages = await providerClient(who.provider, who.accessToken).getSentEmails({ limit: BACKFILL_PAGE, before });
    const merge = await mergeProviderContacts(who.owner, who.provider, contactsFromMessages(messages, who.provider));
    if (!merge.available) return NextResponse.json({ persisted: false, done: true, messages: 0 });

    const next = advanceCursor(previous, messages);
    const saved = await saveSyncCursor(who.owner, who.provider, next);
    return NextResponse.json({
      persisted: saved.available,
      done: next.done,
      messages: messages.length,
      total: next.messages,
      oldest: next.beforeTime,
    });
  } catch (error) {
    console.error('Backfill page failed:', error);
    return NextResponse.json({ error: 'Failed to read older mail' }, { status: 500 });
  }
}
