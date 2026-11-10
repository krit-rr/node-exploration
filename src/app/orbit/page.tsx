'use client';

import AppLayout from '@/components/Layout/AppLayout';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import OrbitMap from '@/components/OrbitMap';
import { persistContacts, useContacts, type ContactsData } from '@/hooks/useContacts';
import { computeOrbit, contactsAsOf, displacedByIntent, LAYER_CAPACITY, LAYER_NAMES, orbitMoves, type OrbitPoint } from '@/utils/orbit';
import { useIntros } from '@/hooks/useIntros';
import { useTieModel } from '@/hooks/useTieModel';
import { MIN_LABELS } from '@/utils/tieStrength';
import { cadenceStatus } from '@/utils/reconnect';
import { MAX_INTERACTIONS } from '@/utils/interactions';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_WEEKS_BACK = 52;

type Intent = 1 | 2 | 3 | 4 | null;

const INTENT_OPTIONS: { layer: Intent; label: string }[] = [
  { layer: 1, label: 'Closest 5' },
  { layer: 2, label: '15' },
  { layer: 3, label: '50' },
  { layer: 4, label: '150' },
  { layer: null, label: 'Let drift' },
];

/**
 * The orbit map: who is actually close, who is drifting, and where you want
 * each person to be. Dragging into the inner two rings marks someone as
 * priority for the Going cold rail.
 */
export default function OrbitPage() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email;
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useContacts();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);

  // Group members count as priority, as on the other pages.
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  useEffect(() => {
    fetch('/api/groups')
      .then(response => (response.ok ? response.json() : { groups: [] }))
      .then(body => {
        const groups: { members?: string[] }[] = Array.isArray(body.groups) ? body.groups : [];
        setGroupMembers(groups.flatMap(g => g.members ?? []));
      })
      .catch(() => {});
  }, []);
  const priorityEmails = useMemo(() => new Set(groupMembers.map(m => m.toLowerCase())), [groupMembers]);

  // Replay: scrub up to a year back and the map shows where everyone sat then.
  // The layout follows the slider a beat behind, so the thumb never waits for a recompute.
  const [weeksAgo, setWeeksAgo] = useState(0);
  const shownWeeksAgo = useDeferredValue(weeksAgo);
  const at = useMemo(() => (shownWeeksAgo === 0 ? null : Date.now() - shownWeeksAgo * WEEK_MS), [shownWeeksAgo]);
  const replay = useMemo(() => (at === null ? null : contactsAsOf(contacts, at)), [contacts, at]);
  const model = useTieModel();
  const layout = useMemo(() => {
    if (!replay || at === null) return computeOrbit(contacts, { priorityEmails, model });
    return computeOrbit(replay.contacts, { now: at, replay: true });
  }, [contacts, priorityEmails, replay, at, model]);
  const replaying = weeksAgo > 0 || replay !== null;
  const thenLabel = `${shownWeeksAgo} week${shownWeeksAgo === 1 ? '' : 's'} ago`;
  const [selected, setSelected] = useState<string | null>(null);
  const point = layout.points.find(p => p.email === selected) ?? null;
  const goingCold = layout.points.filter(p => p.goingCold).length;

  // This week's drift, by activity alone: who slipped out, who moved in.
  const moves = useMemo(() => orbitMoves(contacts, { now: Date.now() }), [contacts]);
  const nameOf = (email: string) => contacts.find(c => c.email.toLowerCase() === email)?.name || email;
  // Introductions worth making, drawn as arcs between the two people.
  const intros = useIntros();
  const arcs = useMemo(
    () => intros.slice(0, 3).map(intro => ({ a: intro.a.email, b: intro.b.email, title: `${intro.a.name} and ${intro.b.name}: ${intro.reason}` })),
    [intros]
  );

  const applyContacts = (next: typeof contacts) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', userEmail], old =>
      old ? { ...old, contacts: next } : old
    );
    if (userEmail) persistContacts(userEmail, next);
  };

  // Capacity is visible: the inner two rings hold five and fifteen, so
  // putting a sixth person in means naming who moves out, and saying so.
  const [pendingIntent, setPendingIntent] = useState<{ email: string; layer: 1 | 2; displaced: OrbitPoint } | null>(null);
  const requestIntent = (email: string, layer: Intent) => {
    if (layer !== 1 && layer !== 2) {
      setIntent(email, layer);
      return;
    }
    const displaced = displacedByIntent(layout, email, layer);
    if (!displaced) {
      setIntent(email, layer);
      return;
    }
    setPendingIntent({ email, layer, displaced });
  };
  const confirmIntent = async () => {
    if (!pendingIntent) return;
    const { email, layer, displaced } = pendingIntent;
    setPendingIntent(null);
    await setIntent(displaced.email, (layer + 1) as 2 | 3);
    await setIntent(email, layer);
  };

  const setIntent = async (email: string, layer: Intent) => {
    // Optimistic: the map and the other pages see the new intent at once,
    // and the previous list comes back if the server says no.
    const previous = contacts;
    applyContacts(contacts.map(c =>
      c.email.toLowerCase() === email ? { ...c, intendedLayer: layer ?? undefined } : c
    ));
    try {
      const response = await fetch('/api/contacts/orbit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, layer }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      if (!body.persisted) {
        toast(body.reason === 'not-found'
          ? 'Kept for this session only: this person is not in your synced list yet'
          : 'Kept for this session only: run the orbit migration to save it', {
          style: { backgroundColor: '#F4F4FF', color: '#1E1E3F' },
        });
      }
    } catch {
      applyContacts(previous);
      toast.error('Could not save where you put them; the dot is back where it was');
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-[#1E1E3F]">Orbit</h1>
          <p className="text-sm text-gray-500">
            Distance is how close you actually are, from how recently and how often you write. Drag a dot inward to say where someone should be.
          </p>
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading your network…</p>}
        {Boolean(error) && !isLoading && (
          <p className="text-sm text-red-600">Could not load contacts right now.</p>
        )}
        {!isLoading && !error && layout.total === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
            Nothing to orbit yet. Sync your mailbox or add a contact and come back.
          </div>
        )}

        {layout.total > 0 && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <OrbitMap
                layout={layout}
                selected={selected}
                onSelect={setSelected}
                onIntent={requestIntent}
                readOnly={replaying}
                moves={replaying ? [] : moves}
                arcs={replaying ? [] : arcs}
              />
              <div className="flex items-center gap-3 px-2 pt-3">
                <label htmlFor="orbit-weeks" className="text-xs text-gray-500 flex-none w-24">
                  {replaying ? `${weeksAgo} week${weeksAgo === 1 ? '' : 's'} ago` : 'Now'}
                </label>
                <input
                  id="orbit-weeks"
                  type="range"
                  min={0}
                  max={MAX_WEEKS_BACK}
                  value={weeksAgo}
                  onChange={event => setWeeksAgo(Number(event.target.value))}
                  className="flex-1 accent-[#1E1E3F]"
                  aria-label="Weeks ago"
                  style={{ direction: 'rtl' }}
                />
              </div>
              <p className="px-2 pt-1 text-[11px] text-gray-400">
                {replaying
                  ? 'Replaying where everyone sat then, by activity alone. Drag works in the present.'
                  : 'Slide left to replay the last year of drift.'}
              </p>
              {!replaying && (
                <p className="px-2 pt-1 text-[11px] text-gray-400">
                  {model.labels >= MIN_LABELS
                    ? `Closeness has learned from ${model.labels} of your touches, snoozes and marks.`
                    : `Closeness is the built-in rule for now. It learns from each touch you log, each snooze, and each person you mark; ${MIN_LABELS} are needed before it counts.`}
                </p>
              )}
              {replay && replay.beyondRecord > 0 && (
                <p className="px-2 pt-1 text-[11px] text-gray-400">
                  {replay.beyondRecord === 1 ? '1 person has' : `${replay.beyondRecord} people have`} more history than Node keeps (the newest {MAX_INTERACTIONS} messages), so this far back {replay.beyondRecord === 1 ? 'they are' : 'they are'} left out rather than shown as strangers.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#D97706]" /> going cold</span>
                {!replaying && (
                  <>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#4B4BA6]/70 ring-1 ring-[#1E1E3F]" /> priority</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full border border-[#1E1E3F]/60" /> where you want them</span>
                    {moves.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-[#D97706]/70" /> moved this week</span>}
                    {arcs.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed border-[#1E1E3F]/50" /> an intro worth making</span>}
                  </>
                )}
              </div>
            </div>

            <aside className="bg-white rounded-xl border border-gray-200 p-4 text-sm">
              {pendingIntent && (
                <div className="mb-4 rounded-lg border border-[#1E1E3F]/20 bg-[#F4F4FF] p-3 text-xs text-[#1E1E3F]">
                  <p>
                    Your {LAYER_NAMES[pendingIntent.layer - 1]} holds {LAYER_CAPACITY[pendingIntent.layer - 1]} and is full. Putting {nameOf(pendingIntent.email)} in moves {pendingIntent.displaced.contact.name} out to the {LAYER_NAMES[pendingIntent.layer]}.
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button onClick={confirmIntent} className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]">
                      Move them
                    </button>
                    <button onClick={() => setPendingIntent(null)} className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {point ? (
                <div className="flex flex-col gap-3">
                  {replaying && <p className="text-xs font-medium text-[#1E1E3F]">As of {thenLabel}</p>}
                  <div>
                    <p className="font-semibold text-[#1E1E3F] truncate">{point.contact.name}</p>
                    <p className="text-xs text-gray-500 truncate">{point.contact.company || point.email}</p>
                  </div>
                  <p className="text-xs text-gray-500">{cadenceStatus(point.assessment, { then: replaying })}</p>
                  <p className="text-xs text-gray-500">
                    {replaying ? 'Sat in your' : 'Sits in your'} {LAYER_NAMES[point.layer - 1]} by activity{replaying ? ' then' : ''}
                    {point.goingCold ? <span className="ml-1 text-[#B45309]">· going cold</span> : null}
                    {point.priority ? <span className="ml-1 text-[#1E1E3F]">· priority</span> : null}
                  </p>
                  {replaying ? (
                    <p className="text-[11px] text-gray-400">Where you want them is a mark you make today. Slide back to now to change it.</p>
                  ) : (
                  <div>
                    <p className="text-xs font-medium text-[#1E1E3F] mb-1.5">Where you want them</p>
                    <div className="flex flex-wrap gap-1.5">
                      {INTENT_OPTIONS.map(option => {
                        const current = (point.contact.intendedLayer ?? null) === option.layer;
                        return (
                          <button
                            key={String(option.layer)}
                            onClick={() => requestIntent(point.email, option.layer)}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors disabled:opacity-50 ${
                              current
                                ? 'bg-[#1E1E3F] text-white border-[#1E1E3F]'
                                : 'border-gray-200 text-[#1E1E3F] hover:bg-gray-50'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">The closest two rings count as priority in Going cold.</p>
                  </div>
                  )}
                  <a
                    href={`mailto:${point.email}`}
                    className="self-start text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                  >
                    Email
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-3 text-gray-600">
                  <p className="font-semibold text-[#1E1E3F]">{replaying ? `Your network ${thenLabel}` : 'Your network, by closeness'}</p>
                  <ul className="text-xs text-gray-500 space-y-1">
                    {LAYER_NAMES.map((name, i) => (
                      <li key={name} className="flex justify-between">
                        <span>{name}</span>
                        <span className="tabular-nums">{layout.counts[i]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-500">
                    {goingCold === 0
                      ? (replaying ? `Nobody was going cold ${thenLabel}.` : 'Nobody is going cold right now.')
                      : replaying
                        ? `${goingCold} ${goingCold === 1 ? 'person was' : 'people were'} going cold against their own rhythm ${thenLabel}.`
                        : `${goingCold} ${goingCold === 1 ? 'person is' : 'people are'} going cold against their own rhythm.`}
                  </p>
                  {!replaying && moves.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[#1E1E3F] mb-1">This week</p>
                      <ul className="text-xs text-gray-500 space-y-1">
                        {moves.slice(0, 5).map(move => (
                          <li key={move.email}>
                            <button onClick={() => setSelected(move.email)} className="text-left hover:text-[#1E1E3F]">
                              {nameOf(move.email)} {move.to > move.from ? 'slipped' : 'moved in'} from the {LAYER_NAMES[move.from - 1]} to the {LAYER_NAMES[move.to - 1]}
                            </button>
                          </li>
                        ))}
                        {moves.length > 5 && <li>and {moves.length - 5} more</li>}
                      </ul>
                    </div>
                  )}
                  {!replaying && arcs.length > 0 && (
                    <p className="text-xs text-gray-500">
                      The dashed arcs are introductions worth making; hover one for the reason, or see Insights for the notes.
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {replaying
                      ? 'Click a dot for details. Slide back to now to drag.'
                      : 'Click a dot for details. Drag it to a ring to say where that person should be; the hollow marker remembers it.'}
                  </p>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
