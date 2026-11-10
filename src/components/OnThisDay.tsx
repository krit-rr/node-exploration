'use client';

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import type { Contact } from '@/types';
import { composeLabel, composeOpensInBrowser, composeUrl } from '@/utils/compose';
import { firstName } from '@/utils/draft';
import { anniversaryLine, onThisDay, yearsText } from '@/utils/onThisDay';

interface Props {
  contacts: Contact[];
}

const SHOW = 3;

/** "A year ago this week you met Alex at Climate Week": a reason to write that costs nothing. */
export default function OnThisDay({ contacts }: Props) {
  const { data: session } = useSession();
  const provider = session?.provider;
  const from = firstName(session?.user?.name ?? '', '');
  const anniversaries = useMemo(() => onThisDay(contacts), [contacts]);
  if (anniversaries.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="font-medium text-[#1E1E3F] mb-2">On this day</p>
      <ul className="space-y-1.5">
        {anniversaries.slice(0, SHOW).map(anniversary => {
          const years = yearsText(anniversary.years).toLowerCase();
          const body = `Hi ${firstName(anniversary.name, 'there')},\n\nIt has been ${years} this week since we met at ${anniversary.metAt}, and I thought of you. How have things been?\n\n${from}`;
          return (
            <li key={anniversary.email} className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span className="flex-1 min-w-0">{anniversaryLine(anniversary)}</span>
              <a
                href={composeUrl(provider, anniversary.email, `${yearsText(anniversary.years)} since ${anniversary.metAt}`, body)}
                target={composeOpensInBrowser(provider) ? '_blank' : undefined}
                rel="noreferrer"
                className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50 transition-colors flex-none"
                title={`Open a note to ${anniversary.name} in ${composeLabel(provider)}`}
              >
                Say hello
              </a>
            </li>
          );
        })}
        {anniversaries.length > SHOW && <li className="text-xs text-gray-400">and {anniversaries.length - SHOW} more this week</li>}
      </ul>
    </div>
  );
}
