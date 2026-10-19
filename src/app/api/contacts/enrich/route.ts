import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrichBatchViaAI } from '@/utils/enrichBatchViaAI';
import { listUnenriched, applyEnrichment } from '@/lib/contactsStore';
import { rateLimit } from '@/lib/rateLimit';

const MAX_PER_RUN = 300;

/**
 * POST /api/contacts/enrich — enrich stored contacts that have no company
 * yet and persist the results. Runs out-of-band from contact fetching so
 * /api/contacts never blocks on OpenAI; the client fires this after a sync
 * and refetches when it finishes.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`enrich:${owner}`, { limit: 4, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many enrichment requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const pending = await listUnenriched(owner, MAX_PER_RUN);
    if (!pending.available) {
      return NextResponse.json({ enriched: 0, persisted: false });
    }
    if (pending.contacts.length === 0) {
      return NextResponse.json({ enriched: 0, persisted: true });
    }

    const enriched = await enrichBatchViaAI(pending.contacts, {
      delayMs: 200,
      maxRetries: 2,
      cacheByDomain: true,
    });

    const result = await applyEnrichment(
      owner,
      enriched.map((c) => ({ email: c.email, company: c.company, industry: c.industry }))
    );

    return NextResponse.json({ enriched: result.updated, persisted: result.available });
  } catch (error) {
    console.error('Enrichment run failed:', error);
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 500 });
  }
}
