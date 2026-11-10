'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { composeLabel, composeOpensInBrowser, composeUrl } from '@/utils/compose';
import { firstName } from '@/utils/draft';
import { dismissIntro, readDismissedIntros, type IntroPerson, type IntroSuggestion } from '@/utils/intros';

const SHOW = 3;
/** Thirty vector lookups per request: ask once per visit, not once per mount. */
const STALE_MS = 10 * 60 * 1000;

/** The double opt-in note: ask one side first, connect once they say yes. */
function introNote(to: IntroPerson, other: IntroPerson, alike: string, from: string): { subject: string; body: string } {
  return {
    subject: `Intro to ${other.name}?`,
    body: [
      `Hi ${firstName(to.name, 'there')},`,
      '',
      `Would you be open to an intro to ${other.name}${other.company ? ` at ${other.company}` : ''}? ${alike}, and I think you would get on. If yes, I will connect you both.`,
      '',
      from,
    ].join('\n'),
  };
}

async function fetchIntros(): Promise<IntroSuggestion[]> {
  const response = await fetch('/api/contacts/intros', { method: 'POST' });
  if (!response.ok) throw new Error(`Intros request failed: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.intros) ? (body.intros as IntroSuggestion[]) : [];
}

/**
 * Three introductions worth making, with the reason in one line and a
 * ready-to-edit note to either side. Dismissing one is final for this
 * browser; it is purged on sign-out with the other user-scoped keys.
 */
export default function IntroSuggestions() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const provider = session?.provider;
  const from = firstName(session?.user?.name ?? '', '');
  const { data: intros = [] } = useQuery({
    queryKey: ['intros', userEmail],
    queryFn: fetchIntros,
    enabled: Boolean(userEmail),
    staleTime: STALE_MS,
    retry: false,
  });
  // Read with the user known, in the same render as the cards, so a dismissed card never flashes.
  const [dismissedVersion, setDismissedVersion] = useState(0);
  const dismissed = useMemo(
    () => (userEmail ? readDismissedIntros(userEmail) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userEmail, dismissedVersion]
  );

  const visible = useMemo(() => intros.filter(i => !dismissed.has(i.key)).slice(0, SHOW), [intros, dismissed]);
  if (visible.length === 0) return null;

  const dismiss = (key: string) => {
    if (userEmail) dismissIntro(userEmail, key);
    setDismissedVersion(v => v + 1);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-[#1E1E3F]">Intros you could make</h2>
        <p className="text-sm text-gray-500">
          Two people with alike profiles who are not colleagues, both of whom you have written to lately. Ask one side first; the note is ready to edit.
        </p>
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
        {visible.map(intro => {
          const toA = introNote(intro.a, intro.b, intro.alike, from);
          const toB = introNote(intro.b, intro.a, intro.alike, from);
          const newTab = composeOpensInBrowser(provider) ? '_blank' : undefined;
          return (
            <div key={intro.key} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1.5 min-w-0">
              <p className="font-medium text-[#1E1E3F] truncate">
                {intro.a.name} <span className="text-gray-400 font-normal">and</span> {intro.b.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {intro.a.company || intro.a.email} <span className="text-gray-300">|</span> {intro.b.company || intro.b.email}
              </p>
              <p className="text-xs text-gray-500">{intro.reason}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                <a
                  href={composeUrl(provider, intro.a.email, toA.subject, toA.body)}
                  target={newTab}
                  rel="noreferrer"
                  className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors truncate max-w-[12rem]"
                  title={`Open a note to ${intro.a.name} in ${composeLabel(provider)}`}
                >
                  Ask {firstName(intro.a.name, intro.a.email)}
                </a>
                <a
                  href={composeUrl(provider, intro.b.email, toB.subject, toB.body)}
                  target={newTab}
                  rel="noreferrer"
                  className="text-xs font-medium px-2 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50 transition-colors truncate max-w-[12rem]"
                  title={`Open a note to ${intro.b.name} in ${composeLabel(provider)}`}
                >
                  Ask {firstName(intro.b.name, intro.b.email)}
                </a>
                <button
                  onClick={() => dismiss(intro.key)}
                  className="text-xs px-1.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                  title="Not a good intro; do not suggest it again"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
