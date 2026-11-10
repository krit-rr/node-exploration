import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import pLimit from 'p-limit';
import { authOptions } from '@/lib/auth';
import { listContactsByEmail, saveMemory } from '@/lib/contactsStore';
import { extractMemory, memoryAvailable, needsMemory } from '@/lib/memory';
import { rateLimit } from '@/lib/rateLimit';
import type { ContactMemory } from '@/types';

const MAX_PER_REQUEST = 8;
const CONCURRENCY = 3;

/**
 * POST /api/contacts/memory: read (or re-read with force) the memory of up
 * to eight contacts the caller is looking at. Unchanged history costs no
 * model call: the stored memory is returned when its source hash matches.
 * Spend is bounded by what the user opens, never by the size of the list.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`memory:${owner}`, { limit: 6, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many memory requests, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const body = await request.json();
    const emails: string[] = Array.isArray(body?.emails)
      ? body.emails.filter((e: unknown): e is string => typeof e === 'string' && e.includes('@')).map((e: string) => e.toLowerCase()).slice(0, MAX_PER_REQUEST)
      : [];
    const force = body?.force === true;
    if (emails.length === 0) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    if (!memoryAvailable()) {
      return NextResponse.json({ error: 'No model is configured for memory' }, { status: 503 });
    }

    const stored = await listContactsByEmail(owner, emails);
    if (!stored.available) {
      return NextResponse.json({ memories: {}, persisted: false });
    }

    const memories: Record<string, ContactMemory> = {};
    let persisted = true;
    const limit = pLimit(CONCURRENCY);
    await Promise.all(
      stored.contacts.map(contact =>
        limit(async () => {
          const email = contact.email.toLowerCase();
          if (!force && !needsMemory(contact)) {
            if (contact.memory) memories[email] = contact.memory;
            return;
          }
          const memory = await extractMemory(contact);
          if (!memory) return;
          memories[email] = memory;
          const saved = await saveMemory(owner, email, memory);
          if (!saved.available) persisted = false;
        })
      )
    );

    return NextResponse.json({ memories, persisted });
  } catch (error) {
    console.error('Memory extraction failed:', error);
    return NextResponse.json({ error: 'Failed to read memory' }, { status: 500 });
  }
}
