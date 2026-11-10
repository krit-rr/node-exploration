import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { embedText } from '@/lib/embeddings';
import { answerQuestion } from '@/lib/ask';
import { rateLimit } from '@/lib/rateLimit';
import { openaiConfigured } from '@/lib/openai';
import { rankPeople, type AskHit } from '@/utils/ask';
import { getTieModel } from '@/lib/tieStore';

const CANDIDATES = 12;
const MAX_QUESTION = 300;

/** The vector migration is not applied, or nothing is embedded yet: nothing to search. */
function isMissingIndex(error: { code?: string; message?: string }): boolean {
  return error.code === '42883' || error.code === 'PGRST202' || error.code === '42P01' || /could not find the function|does not exist/i.test(error.message ?? '');
}

/**
 * POST /api/ask { question }: who in the network fits a question, with the
 * facts on record and, when a model is configured, a short grounded answer.
 * One embedding call for the question, two index lookups, one model call.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = session.user.email.toLowerCase();

  const limited = rateLimit(`ask:${owner}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many questions, slow down' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const question = typeof body?.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION) : '';
    if (!question) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    if (!openaiConfigured()) {
      return NextResponse.json({ error: 'No model is configured for search' }, { status: 503 });
    }

    const [stored, groups, queryEmbedding] = await Promise.all([listContacts(owner), listGroups(owner), embedText(question)]);
    if (!stored.available || stored.contacts.length === 0) {
      return NextResponse.json({ answer: '', people: [], source: 'facts', indexed: false });
    }
    const supabase = getSupabaseAdmin();
    const [contactHits, interactionHits] = await Promise.all([
      supabase.rpc('match_contacts', { p_owner: owner, p_query: queryEmbedding, p_count: CANDIDATES, p_min_similarity: 0.15 }),
      supabase.rpc('match_interactions', { p_owner: owner, p_query: queryEmbedding, p_contact: null, p_count: CANDIDATES, p_min_similarity: 0.15 }),
    ]);
    for (const result of [contactHits, interactionHits]) {
      if (result.error && !isMissingIndex(result.error)) {
        console.error('Ask lookup failed:', result.error);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
      }
    }
    if (contactHits.error && interactionHits.error) {
      return NextResponse.json({ answer: '', people: [], source: 'facts', indexed: false });
    }

    const hits: AskHit[] = [
      ...((contactHits.data ?? []) as { contact_email: string; similarity: number }[]).map(row => ({
        email: row.contact_email,
        similarity: Number(row.similarity) || 0,
      })),
      ...((interactionHits.data ?? []) as { contact_email: string; content: string; interaction_date: string; similarity: number }[]).map(row => ({
        email: row.contact_email,
        similarity: Number(row.similarity) || 0,
        interaction: { date: row.interaction_date, content: row.content },
      })),
    ];
    const priorityEmails = new Set(groups.groups.flatMap(g => g.members.map(m => m.toLowerCase())));
    const model = (await getTieModel(owner).catch(() => null))?.model;
    const people = rankPeople(hits, stored.contacts, { priorityEmails, model });
    const answer = await answerQuestion(question, people);

    const response = NextResponse.json({
      answer: answer.answer,
      source: answer.source,
      indexed: true,
      people: answer.people.map(({ email, why }) => {
        const person = people.find(p => p.email === email)!;
        return { email, why, name: person.name, company: person.company, industry: person.industry, layer: person.layer, status: person.status, context: person.context };
      }),
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Ask failed:', error);
    return NextResponse.json({ error: 'Failed to answer' }, { status: 500 });
  }
}
