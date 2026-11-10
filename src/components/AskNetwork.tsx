'use client';

import { useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { composeLabel, composeOpensInBrowser, composeUrl } from '@/utils/compose';
import { firstName } from '@/utils/draft';
import { LAYER_NAMES } from '@/utils/orbit';

type Person = { email: string; name: string; company?: string; industry?: string; layer: 1 | 2 | 3 | 4 | 5; status: string; context?: string; why: string };
type Result = { answer: string; source: 'model' | 'facts'; indexed: boolean; people: Person[] };

const EXAMPLES = [
  'Who do I know in climate fintech?',
  'Who could introduce me to a Series A health founder?',
  'What did Priya and I last discuss?',
];

/**
 * Ask your network: a question answered from your own notes and emails,
 * with the people worth going to and one line each on why. The middle
 * rings rank a little higher than the inner five, who you would think of
 * unaided.
 */
export default function AskNetwork() {
  const { data: session } = useSession();
  const provider = session?.provider;
  const from = firstName(session?.user?.name ?? '', '');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Too many questions in the last minute. Try again shortly.'
            : response.status === 503
              ? 'Asking needs a model configured on this install.'
              : 'Could not answer right now.'
        );
        return;
      }
      setResult({
        answer: String(body?.answer ?? ''),
        source: body?.source === 'model' ? 'model' : 'facts',
        indexed: body?.indexed !== false,
        people: Array.isArray(body?.people) ? body.people : [],
      });
    } catch {
      setError('Could not answer right now.');
    } finally {
      setAsking(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-[#1E1E3F]">Ask your network</h2>
        <p className="text-sm text-gray-500">Answered from your own notes and emails. Who to go to, and why.</p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder={EXAMPLES[0]}
          aria-label="Ask your network"
          maxLength={300}
          className="flex-1 min-w-[16rem] text-sm px-3 py-2 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="text-sm font-medium px-3 py-2 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors disabled:opacity-50"
        >
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </form>
      {!result && !asking && !error && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => { setQuestion(example); ask(example); }}
              className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3">
          {result.answer && <p className="text-sm text-gray-700">{result.answer}</p>}
          {!result.indexed && (
            <p className="text-sm text-gray-500">Nothing is indexed yet. Open the contacts page once so your contacts and emails get embedded, then ask again.</p>
          )}
          {result.indexed && result.people.length === 0 && !result.answer && (
            <p className="text-sm text-gray-500">Nobody on record fits that question.</p>
          )}
          {result.people.length > 0 && (
            <ul className="grid gap-3 grid-cols-1 lg:grid-cols-3">
              {result.people.map(person => (
                <li key={person.email} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1 min-w-0">
                  <p className="font-medium text-[#1E1E3F] truncate">{person.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {[person.company, person.industry].filter(Boolean).join(' · ') || person.email}
                  </p>
                  {person.why && <p className="text-xs text-gray-700">{person.why}</p>}
                  {person.context && person.context !== person.why && <p className="text-xs text-gray-500">{person.context}</p>}
                  <p className="text-[11px] text-gray-400">{person.status} · in your {LAYER_NAMES[person.layer - 1]}</p>
                  <a
                    href={composeUrl(provider, person.email, '', `Hi ${firstName(person.name, 'there')},\n\n${from}`)}
                    target={composeOpensInBrowser(provider) ? '_blank' : undefined}
                    rel="noreferrer"
                    className="self-start mt-auto text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                    title={`Open a note to ${person.name} in ${composeLabel(provider)}`}
                  >
                    Email {firstName(person.name, person.email)}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-gray-400">
            {result.source === 'model'
              ? 'Written from your notes and emails about the people named. Check before you act on it.'
              : 'The people whose notes and emails match the question, closest match first.'}
          </p>
        </div>
      )}
    </div>
  );
}
