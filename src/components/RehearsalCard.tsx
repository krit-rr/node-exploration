'use client';

import { useMemo, useState } from 'react';
import { Dialog } from '@headlessui/react';
import toast from 'react-hot-toast';
import type { Contact, RehearsalEntry } from '@/types';
import { dueCards, nextEntry, rotation, SESSION_SIZE, type RehearsalCard as Card } from '@/utils/rehearsal';

interface Props {
  contacts: Contact[];
  /** Keep an answered card's new schedule with the contact (the server has it too). */
  onRecorded: (email: string, entry: RehearsalEntry) => void;
}

/**
 * "Who was this?": the context you captured comes first, the name second.
 * Got it pushes the card out on an expanding schedule; Missed brings it
 * back tomorrow. The schedule is stored on the contact.
 */
export default function RehearsalCard({ contacts, onRecorded }: Props) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState({ got: 0, missed: 0 });
  const [warnedUnpersisted, setWarnedUnpersisted] = useState(false);

  const summary = useMemo(() => rotation(contacts), [contacts]);
  if (summary.total === 0) return null;

  const start = () => {
    setQueue(dueCards(contacts));
    setIndex(0);
    setRevealed(false);
    setDone({ got: 0, missed: 0 });
    setOpen(true);
  };

  const answer = async (result: 'got' | 'missed') => {
    const card = queue[index];
    if (!card) return;
    // Optimistic: the same rule the server applies, then the server's word.
    onRecorded(card.email, nextEntry(card.contact.rehearsal, result));
    setDone(d => ({ ...d, [result]: d[result] + 1 }));
    setRevealed(false);
    setIndex(i => i + 1);
    try {
      const response = await fetch('/api/contacts/rehearsal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: card.email, result }),
      });
      const body = response.ok ? await response.json() : null;
      if (body?.entry) onRecorded(card.email, body.entry);
      if (body && !body.persisted && !warnedUnpersisted) {
        setWarnedUnpersisted(true);
        toast('Progress is kept for this session only until the rehearsal migration runs');
      }
    } catch {
      // The optimistic entry stands for this session; the next answer retries the server.
    }
  };

  const card = queue[index];
  const finished = open && !card;
  const remaining = summary.due;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[#1E1E3F]">Names to rehearse</p>
          <p className="text-sm text-gray-500">
            {summary.due > 0
              ? `${summary.due} ${summary.due === 1 ? 'card is' : 'cards are'} due, ${summary.total} in rotation. A sitting is ${Math.min(SESSION_SIZE, summary.due)} ${Math.min(SESSION_SIZE, summary.due) === 1 ? 'card' : 'cards'}, two minutes, and the names from your last event stop evaporating.`
              : `Nothing due. ${summary.total} in rotation; the next card comes back in ${summary.nextDueDays ?? 1} day${summary.nextDueDays === 1 ? '' : 's'}.`}
          </p>
        </div>
        <button
          onClick={start}
          disabled={summary.due === 0}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors disabled:opacity-50 flex-none"
        >
          Start
        </button>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            {finished ? (
              <div className="flex flex-col gap-3">
                <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">
                  {remaining > 0 ? 'Sitting done' : 'Done for today'}
                </Dialog.Title>
                <p className="text-sm text-gray-600">
                  {done.got} remembered, {done.missed} missed. Missed ones come back tomorrow; the rest move out to a longer gap.
                  {remaining > 0 ? ` ${remaining} more ${remaining === 1 ? 'is' : 'are'} still due; start again whenever you like.` : ''}
                </p>
                <div className="flex items-center justify-end gap-2">
                  {remaining > 0 && (
                    <button onClick={start} className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50">
                      Next sitting
                    </button>
                  )}
                  <button onClick={() => setOpen(false)} className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]">
                    Close
                  </button>
                </div>
              </div>
            ) : card ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">Who was this?</Dialog.Title>
                  <span className="text-xs text-gray-400">{index + 1} of {queue.length}</span>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 space-y-1">
                  {card.prompt.metAt && <p>Met at <span className="font-medium text-[#1E1E3F]">{card.prompt.metAt}</span></p>}
                  {card.prompt.company && <p>Works at <span className="font-medium text-[#1E1E3F]">{card.prompt.company}</span>{card.prompt.industry ? `, ${card.prompt.industry}` : ''}</p>}
                  {card.prompt.introducedBy && <p>Introduced by {card.prompt.introducedBy}</p>}
                  {card.prompt.note && <p className="text-gray-600">{card.contact.notes?.trim() ? 'Your note: ' : 'Last subject: '}{card.prompt.note}</p>}
                  {card.prompt.tags.length > 0 && <p className="text-xs text-gray-500">Tags: {card.prompt.tags.join(', ')}</p>}
                </div>
                {revealed ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-xl font-semibold text-[#1E1E3F]">{card.contact.name}</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => answer('got')} className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]">Got it</button>
                      <button onClick={() => answer('missed')} className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50">Missed</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setRevealed(true)} className="self-start text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]">
                    Show the name
                  </button>
                )}
              </div>
            ) : null}
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
