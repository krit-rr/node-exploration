'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Contact, type ContactMemory } from '@/types';
import { composeLabel, composeOpensInBrowser, composeUrl } from '@/utils/compose';
import { draftFromTemplate } from '@/utils/draft';
import { cadenceStatus, computeReconnectQueue, type ReconnectCandidate } from '@/utils/reconnect';
import { safeFormatDate } from '@/utils/dates';
import { memoryIsStale } from '@/utils/interactions';

export type TouchChannel = 'email' | 'call' | 'meeting' | 'other';

interface Props {
  contacts: Contact[];
  /** Apply a snooze to local state; the rail fires the API call itself. */
  onSnoozed: (email: string, snoozedUntil: string) => void;
  /** Apply a logged touch to local state; the rail fires the API call itself. */
  onTouchLogged: (email: string, channel: TouchChannel) => void;
  /** Extra priority members (everyone in a group); the key-contact tag is read from the contact itself. */
  priorityEmails?: Set<string>;
  compact?: boolean;
  /**
   * When given, the rail reads memory (open loops) for the people it shows
   * and hands the results back for the page to keep. Left out, nothing is
   * read and no model call is made.
   */
  onMemoryLoaded?: (memories: Record<string, ContactMemory>) => void;
}

type Draft = { email: string; subject: string; body: string; note: string };

/** The footer under a draft says where it came from, and only what is true. */
const DRAFT_NOTE = {
  model: 'Written from your notes and emails. Edit before sending.',
  'no-model': 'Assembled from your notes, no model configured. Edit before sending.',
  'model-failed': 'Assembled from your notes. The model did not answer this time. Edit before sending.',
  local: 'Assembled from your notes. Edit before sending.',
  limited: 'Too many drafts in the last minute, so this one is assembled from your notes. Edit before sending.',
} as const;

/** Why this card is here, against the pair's own rhythm or the user's. */
function rhythmTitle(candidate: ReconnectCandidate): string {
  const pct = Math.round(candidate.overdue * 100);
  return candidate.cadence.source === 'pair'
    ? `A ${pct}% chance this silence is already past this relationship's usual gap, learned from ${candidate.cadence.gaps} past conversations`
    : `A ${pct}% chance this silence is already past your usual gap; too little history with this person to know their own rhythm yet`;
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
export default function ReconnectRail({ contacts, onSnoozed, onTouchLogged, priorityEmails, compact = false, onMemoryLoaded }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [logging, setLogging] = useState<string | null>(null);
  const memoryRequested = useRef<Set<string>>(new Set());
  const { data: session } = useSession();
  const provider = session?.provider;
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const queue = useMemo(
    () =>
      computeReconnectQueue(contacts, { limit: compact ? 3 : 5, priorityEmails })
        .filter(c => !hidden.has(c.contact.email)),
    [contacts, compact, hidden, priorityEmails]
  );

  // Read the open loops for the people on the rail, once each, only when
  // the page wants them. Unchanged history is free server-side.
  useEffect(() => {
    if (!onMemoryLoaded) return;
    const emails = queue
      .map(c => c.contact)
      .filter(c => memoryIsStale(c) && !memoryRequested.current.has(c.email))
      .map(c => c.email);
    if (emails.length === 0) return;
    for (const email of emails) memoryRequested.current.add(email);
    fetch('/api/contacts/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (body?.memories && Object.keys(body.memories).length > 0) onMemoryLoaded(body.memories);
      })
      .catch(() => {});
  }, [queue, onMemoryLoaded]);

  const hide = (email: string) => setHidden(prev => new Set(prev).add(email));

  // The hardest step is the first sentence: ask for a draft, let the user
  // edit it on the card, then open it in their own mail client.
  // The same template the server uses, from what the card already knows,
  // for when the server cannot answer: a card always ends in an email.
  const localDraft = (candidate: ReconnectCandidate, note: string): Draft => {
    const draft = draftFromTemplate({
      contact: candidate.contact,
      userName: session?.user?.name ?? '',
      daysSince: candidate.daysSince,
      neverTouched: candidate.neverTouched,
      typicalDays: candidate.cadence.source === 'pair' ? candidate.cadence.typicalDays : undefined,
    });
    return { email: candidate.contact.email, subject: draft.subject, body: draft.body, note };
  };

  const requestDraft = async (candidate: ReconnectCandidate) => {
    const email = candidate.contact.email;
    if (drafting) return;
    setDrafting(email);
    setLogging(null);
    try {
      const response = await fetch('/api/contacts/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setDraft(localDraft(candidate, DRAFT_NOTE.limited));
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      if (typeof body?.body !== 'string' || !body.body) throw new Error('Empty draft');
      const note = body.source === 'model'
        ? DRAFT_NOTE.model
        : body.reason === 'model-failed' ? DRAFT_NOTE['model-failed'] : DRAFT_NOTE['no-model'];
      setDraft({ email, subject: String(body.subject ?? ''), body: body.body, note });
    } catch {
      setDraft(localDraft(candidate, DRAFT_NOTE.local));
    } finally {
      setDrafting(null);
    }
  };

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
                  {candidate.priority && <span className="mr-1 text-[#1E1E3F]/60" title="Priority: tagged key-contact, in a group, or placed in your inner orbit">✦</span>}
                  {candidate.contact.name}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {candidate.contact.company || email}
                </p>
              </div>
              <p className="text-xs text-gray-400" title={rhythmTitle(candidate)}>
                {cadenceStatus(candidate)}
                {candidate.lastSubject ? <> &middot; <span className="italic">&ldquo;{candidate.lastSubject}&rdquo;</span></> : null}
              </p>
              {candidate.contact.metAt && (
                <p className="text-xs text-gray-400 truncate">Met at {candidate.contact.metAt}</p>
              )}
              {candidate.contact.memory?.openLoops[0] && (
                <p
                  className="text-xs text-[#1E1E3F]/80 truncate"
                  title={`${candidate.contact.memory.openLoops[0].who === 'you' ? 'You' : 'They'} promised to ${candidate.contact.memory.openLoops[0].text}, read from your emails`}
                >
                  {candidate.contact.memory.openLoops[0].who === 'you' ? 'You promised:' : 'They promised:'} {candidate.contact.memory.openLoops[0].text}
                  <span className="text-gray-400"> &middot; {safeFormatDate(candidate.contact.memory.openLoops[0].date, 'MMM d', '')}</span>
                </p>
              )}
              {draft?.email === email ? (
                <div className="flex flex-col gap-1.5 mt-auto pt-1">
                  <input
                    value={draft.subject}
                    onChange={e => setDraft({ ...draft, subject: e.target.value })}
                    aria-label="Subject"
                    className="text-xs px-2 py-1 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20"
                  />
                  <textarea
                    value={draft.body}
                    onChange={e => setDraft({ ...draft, body: e.target.value })}
                    aria-label="Message"
                    rows={6}
                    className="text-xs px-2 py-1 rounded-md border border-gray-200 resize-y focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20"
                  />
                  <p className="text-[11px] text-gray-400">{draft.note}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={composeUrl(provider, email, draft.subject, draft.body)}
                      target={composeOpensInBrowser(provider) ? '_blank' : undefined}
                      rel="noreferrer"
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                    >
                      Open in {composeLabel(provider)}
                    </a>
                    <button
                      onClick={() => { setDraft(null); logTouch(candidate, 'email'); }}
                      className="text-xs font-medium px-2 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50 transition-colors"
                      title="I sent it: log the touch"
                    >
                      Sent it
                    </button>
                    <button
                      onClick={() => setDraft(null)}
                      className="text-xs px-1.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : logging === email ? (
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
                  <button
                    onClick={() => requestDraft(candidate)}
                    disabled={drafting !== null}
                    className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors disabled:opacity-60"
                    title="Write a short opener from your notes and emails, then open it in your mail client"
                  >
                    {drafting === email ? 'Drafting…' : 'Draft'}
                  </button>
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
