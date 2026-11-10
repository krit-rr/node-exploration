'use client';

import AppLayout from '@/components/Layout/AppLayout';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import OrbitMap from '@/components/OrbitMap';
import { persistContacts, useContacts, type ContactsData } from '@/hooks/useContacts';
import { computeOrbit, LAYER_NAMES } from '@/utils/orbit';
import { cadenceStatus } from '@/utils/reconnect';

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

  const layout = useMemo(() => computeOrbit(contacts, { priorityEmails }), [contacts, priorityEmails]);
  const [selected, setSelected] = useState<string | null>(null);
  const point = layout.points.find(p => p.email === selected) ?? null;
  const goingCold = layout.points.filter(p => p.goingCold).length;

  const applyContacts = (next: typeof contacts) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', userEmail], old =>
      old ? { ...old, contacts: next } : old
    );
    if (userEmail) persistContacts(userEmail, next);
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
              <OrbitMap layout={layout} selected={selected} onSelect={setSelected} onIntent={setIntent} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#D97706]" /> going cold</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#4B4BA6]/70 ring-1 ring-[#1E1E3F]" /> priority</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full border border-[#1E1E3F]/60" /> where you want them</span>
              </div>
            </div>

            <aside className="bg-white rounded-xl border border-gray-200 p-4 text-sm">
              {point ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="font-semibold text-[#1E1E3F] truncate">{point.contact.name}</p>
                    <p className="text-xs text-gray-500 truncate">{point.contact.company || point.email}</p>
                  </div>
                  <p className="text-xs text-gray-500">{cadenceStatus(point.assessment)}</p>
                  <p className="text-xs text-gray-500">
                    Sits in your {LAYER_NAMES[point.layer - 1]} by activity
                    {point.goingCold ? <span className="ml-1 text-[#B45309]">· going cold</span> : null}
                    {point.priority ? <span className="ml-1 text-[#1E1E3F]">· priority</span> : null}
                  </p>
                  <div>
                    <p className="text-xs font-medium text-[#1E1E3F] mb-1.5">Where you want them</p>
                    <div className="flex flex-wrap gap-1.5">
                      {INTENT_OPTIONS.map(option => {
                        const current = (point.contact.intendedLayer ?? null) === option.layer;
                        return (
                          <button
                            key={String(option.layer)}
                            onClick={() => setIntent(point.email, option.layer)}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
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
                  <a
                    href={`mailto:${point.email}`}
                    className="self-start text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                  >
                    Email
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-3 text-gray-600">
                  <p className="font-semibold text-[#1E1E3F]">Your network, by closeness</p>
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
                      ? 'Nobody is going cold right now.'
                      : `${goingCold} ${goingCold === 1 ? 'person is' : 'people are'} going cold against their own rhythm.`}
                  </p>
                  <p className="text-xs text-gray-500">
                    Click a dot for details. Drag it to a ring to say where that person should be; the hollow marker remembers it.
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
