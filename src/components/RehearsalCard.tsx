'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { useSession } from 'next-auth/react';
import type { Contact } from '@/types';
import {
  dueCards,
  readRehearsalState,
  recordResult,
  rotation,
  writeRehearsalState,
  type RehearsalCard as Card,
  type RehearsalState,
} from '@/utils/rehearsal';

interface Props {
  contacts: Contact[];
}

function lastSubject(contact: Contact): string | undefined {
  return [...(contact.interactions ?? [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .find(i => i.subject?.trim())?.subject;
}

/**
 * "Who was this?": the context you captured comes first, the name second.
 * Got it pushes the card out on an expanding schedule; Missed brings it
 * back tomorrow.
 */
export default function RehearsalCard({ contacts }: Props) {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const [state, setState] = useState<RehearsalState>({});
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState({ got: 0, missed: 0 });

  useEffect(() => {
    if (userEmail) setState(readRehearsalState(userEmail));
  }, [userEmail]);

  const summary = useMemo(() => rotation(contacts, state), [contacts, state]);
  if (summary.total === 0) return null;

  const start = () => {
    setQueue(dueCards(contacts, state));
    setIndex(0);
    setRevealed(false);
    setDone({ got: 0, missed: 0 });
    setOpen(true);
  };

  const answer = (result: 'got' | 'missed') => {
    const card = queue[index];
    if (!card) return;
    const next = recordResult(state, card.email, result);
    setState(next);
    if (userEmail) writeRehearsalState(userEmail, next);
    setDone(d => ({ ...d, [result]: d[result] + 1 }));
    setRevealed(false);
    setIndex(i => i + 1);
  };

  const card = queue[index];
  const finished = open && !card;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[#1E1E3F]">Names to rehearse</p>
          <p className="text-sm text-gray-500">
            {summary.due > 0
              ? `${summary.due} ${summary.due === 1 ? 'card is' : 'cards are'} due today, ${summary.total} in rotation. Two minutes, and the names from your last event stop evaporating.`
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
                <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">Done for today</Dialog.Title>
                <p className="text-sm text-gray-600">
                  {done.got} remembered, {done.missed} missed. Missed ones come back tomorrow; the rest move out to a longer gap.
                </p>
                <button onClick={() => setOpen(false)} className="self-end text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]">
                  Close
                </button>
              </div>
            ) : card ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">Who was this?</Dialog.Title>
                  <span className="text-xs text-gray-400">{index + 1} of {queue.length}</span>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 space-y-1">
                  {card.contact.metAt && <p>Met at <span className="font-medium text-[#1E1E3F]">{card.contact.metAt}</span></p>}
                  {card.contact.company && <p>Works at <span className="font-medium text-[#1E1E3F]">{card.contact.company}</span>{card.contact.industry ? `, ${card.contact.industry}` : ''}</p>}
                  {card.contact.introducedBy && <p>Introduced by {card.contact.introducedBy}</p>}
                  {card.contact.notes?.trim() && <p className="text-gray-600">Your note: {card.contact.notes.trim().slice(0, 240)}</p>}
                  {!card.contact.notes?.trim() && lastSubject(card.contact) && <p className="text-gray-600">Last subject: &ldquo;{lastSubject(card.contact)}&rdquo;</p>}
                  {(card.contact.tags ?? []).length > 0 && <p className="text-xs text-gray-500">Tags: {(card.contact.tags ?? []).join(', ')}</p>}
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
