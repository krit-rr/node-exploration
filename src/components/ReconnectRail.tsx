'use client';

import { useMemo, useState } from 'react';
import { Contact } from '@/types';
import { computeReconnectQueue, type ReconnectCandidate } from '@/utils/reconnect';

interface Props {
  contacts: Contact[];
  /** Apply a snooze to local state (cache + localStorage); rail fires the API call itself. */
  onSnoozed: (email: string, snoozedUntil: string) => void;
  compact?: boolean;
}

function since(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

/**
 * "Needs attention": the going-cold queue that makes "stay connected
 * forever" a feature instead of a slogan.
 */
export default function ReconnectRail({ contacts, onSnoozed, compact = false }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const queue = useMemo(
    () => computeReconnectQueue(contacts, { limit: compact ? 3 : 5 }).filter(c => !hidden.has(c.contact.email)),
    [contacts, compact, hidden]
  );

  if (queue.length === 0) return null;

  const snooze = (candidate: ReconnectCandidate, days: number) => {
    const email = candidate.contact.email;
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setHidden(prev => new Set(prev).add(email));
    onSnoozed(email, until);
    fetch('/api/contacts/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, days }),
    }).catch(() => {});
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-[#1E1E3F]">Going cold</h2>
          <p className="text-sm text-gray-500">
            {queue.length} relationship{queue.length === 1 ? '' : 's'} worth a touch this week
          </p>
        </div>
      </div>
      <div className={`grid gap-3 ${compact ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'}`}>
        {queue.map(candidate => (
          <div key={candidate.contact.email} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1.5 min-w-0">
            <div className="min-w-0">
              <p className="font-medium text-[#1E1E3F] truncate">{candidate.contact.name}</p>
              <p className="text-xs text-gray-500 truncate">
                {candidate.contact.company || candidate.contact.email}
              </p>
            </div>
            <p className="text-xs text-gray-400">
              Last touch {since(candidate.daysSince)} ago
              {candidate.lastSubject ? <> &middot; <span className="italic truncate">&ldquo;{candidate.lastSubject}&rdquo;</span></> : null}
            </p>
            <div className="flex items-center gap-2 mt-auto pt-1">
              <a
                href={`mailto:${candidate.contact.email}`}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
              >
                Email
              </a>
              <button
                onClick={() => snooze(candidate, 7)}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                title="Snooze one week"
              >
                1w
              </button>
              <button
                onClick={() => snooze(candidate, 30)}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                title="Snooze one month"
              >
                1mo
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
