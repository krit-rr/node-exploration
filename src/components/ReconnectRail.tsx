'use client';

import { useMemo, useState } from 'react';
import { Contact } from '@/types';
import { computeReconnectQueue, type ReconnectCandidate } from '@/utils/reconnect';

export type TouchChannel = 'email' | 'call' | 'meeting' | 'other';

interface Props {
  contacts: Contact[];
  /** Apply a snooze to local state; the rail fires the API call itself. */
  onSnoozed: (email: string, snoozedUntil: string) => void;
  /** Apply a logged touch to local state; the rail fires the API call itself. */
  onTouchLogged: (email: string, channel: TouchChannel) => void;
  /** Extra priority members (e.g. everyone in a group); tagged contacts are always priority. */
  priorityEmails?: Set<string>;
  compact?: boolean;
}

function since(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

const CHANNELS: { key: TouchChannel; label: string }[] = [
  { key: 'email', label: 'Emailed' },
  { key: 'call', label: 'Called' },
  { key: 'meeting', label: 'Met' },
  { key: 'other', label: 'Other' },
];

/**
 * "Going cold": the queue that makes staying in touch a feature. Clearing
 * a card happens by ACTING (log the touch) or deliberately snoozing.
 */
export default function ReconnectRail({ contacts, onSnoozed, onTouchLogged, priorityEmails, compact = false }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [logging, setLogging] = useState<string | null>(null);

  const queue = useMemo(
    () =>
      computeReconnectQueue(contacts, { limit: compact ? 3 : 5, priorityEmails })
        .filter(c => !hidden.has(c.contact.email)),
    [contacts, compact, hidden, priorityEmails]
  );

  const hide = (email: string) => setHidden(prev => new Set(prev).add(email));

  const snooze = (candidate: ReconnectCandidate, days: number) => {
    const email = candidate.contact.email;
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    hide(email);
    onSnoozed(email, until);
    fetch('/api/contacts/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, days }),
    }).catch(() => {});
  };

  const logTouch = (candidate: ReconnectCandidate, channel: TouchChannel) => {
    const email = candidate.contact.email;
    hide(email);
    setLogging(null);
    onTouchLogged(email, channel);
    fetch('/api/contacts/touch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, channel }),
    }).catch(() => {});
  };

  if (queue.length === 0) {
    if (compact) return null;
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 flex items-center gap-3">
        <span className="text-[#1E1E3F]">✦</span>
        <div>
          <p className="font-medium text-[#1E1E3F]">All caught up</p>
          <p className="text-sm text-gray-500">Nobody is going cold right now.</p>
        </div>
      </div>
    );
  }

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
        {queue.map(candidate => {
          const email = candidate.contact.email;
          return (
            <div key={email} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1.5 min-w-0">
              <div className="min-w-0">
                <p className="font-medium text-[#1E1E3F] truncate">
                  {candidate.priority && <span className="mr-1 text-[#1E1E3F]/60" title="Priority: tagged key-contact or in a group">✦</span>}
                  {candidate.contact.name}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {candidate.contact.company || email}
                </p>
              </div>
              <p className="text-xs text-gray-400">
                {candidate.neverTouched
                  ? <>Added {since(candidate.daysSince)} ago, no touch yet</>
                  : <>Last touch {since(candidate.daysSince)} ago</>}
                {candidate.lastSubject ? <> &middot; <span className="italic">&ldquo;{candidate.lastSubject}&rdquo;</span></> : null}
              </p>
              {candidate.contact.metAt && (
                <p className="text-xs text-gray-400 truncate">Met at {candidate.contact.metAt}</p>
              )}
              {logging === email ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                  {CHANNELS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => logTouch(candidate, key)}
                      className="text-xs px-2 py-1 rounded-md bg-[#F4F4FF] text-[#1E1E3F] hover:bg-[#E8E8FF] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setLogging(null)}
                    aria-label="Cancel logging"
                    className="text-xs px-1.5 py-1 text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-auto pt-1">
                  <a
                    href={`mailto:${email}`}
                    className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                  >
                    Email
                  </a>
                  <button
                    onClick={() => setLogging(email)}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50 transition-colors"
                    title="I reached out: log the touch"
                  >
                    Logged
                  </button>
                  <button
                    onClick={() => snooze(candidate, 7)}
                    className="text-xs px-1.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                    title="Snooze one week"
                  >
                    1w
                  </button>
                  <button
                    onClick={() => snooze(candidate, 30)}
                    className="text-xs px-1.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                    title="Snooze one month"
                  >
                    1mo
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
