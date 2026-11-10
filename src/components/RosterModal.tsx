'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@headlessui/react';
import toast from 'react-hot-toast';
import type { Contact } from '@/types';
import { rosterWithout, searchRoster, type RosterEntry } from '@/utils/roster';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  event: string;
  /** The people ticked become contacts stamped with the event; the page lands on them with triage one tap away. */
  onMet: (contacts: Contact[], event: string) => void;
  /** The roster shrank (or was finished and dropped). */
  onRosterChanged: (event: string, remaining: number) => void;
}

/**
 * Tick who you met. The attendee list came in before the event; during it,
 * search and tick. Only the ticked become contacts, stamped with where you
 * met, and the triage deck is ready the morning after.
 */
export default function RosterModal({ isOpen, onClose, event, onMet, onRosterChanged }: Props) {
  const [entries, setEntries] = useState<RosterEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEntries(null);
    setTicked(new Set());
    setQuery('');
    fetch(`/api/rosters?event=${encodeURIComponent(event)}`)
      .then(response => (response.ok ? response.json() : null))
      .then(body => setEntries(Array.isArray(body?.entries) ? body.entries : []))
      .catch(() => setEntries([]));
  }, [isOpen, event]);

  const shown = useMemo(() => searchRoster(entries ?? [], query).slice(0, 200), [entries, query]);

  const toggle = (email: string) =>
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  const addMet = async () => {
    if (!entries || ticked.size === 0 || saving) return;
    setSaving(true);
    try {
      const met = entries.filter(entry => ticked.has(entry.email));
      const response = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: met.map(entry => ({ email: entry.email, name: entry.name, company: entry.company ?? '', metAt: event, tags: [], notes: entry.position ? `${entry.position}${entry.company ? ` at ${entry.company}` : ''}` : '' })),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const imported = (await response.json()) as Contact[];
      const remaining = rosterWithout(entries, ticked);
      const save = await fetch('/api/rosters', {
        method: remaining.length > 0 ? 'PUT' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remaining.length > 0 ? { event, entries: remaining } : { event }),
      });
      if (!save.ok) toast('Added them, but the roster itself did not update; they may show again');
      setEntries(remaining);
      setTicked(new Set());
      onRosterChanged(event, remaining.length);
      onMet(imported, event);
      if (remaining.length === 0) onClose();
    } catch {
      toast.error('Could not add them right now');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
          <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">Who did you meet at {event}?</Dialog.Title>
          <p className="text-sm text-gray-500 mt-1">
            Tick people as you meet them. Only the ticked become contacts, stamped with the event, with the triage deck ready for the morning after.
          </p>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the roster"
            aria-label="Search the roster"
            className="mt-3 w-full text-sm px-3 py-2 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20"
          />
          <div className="mt-3 flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {entries === null ? (
              <p className="p-3 text-sm text-gray-500">Loading the roster…</p>
            ) : entries.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">Everyone on this roster has been ticked or it is empty.</p>
            ) : shown.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">Nobody on the roster matches that.</p>
            ) : (
              shown.map(entry => (
                <label key={entry.email} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={ticked.has(entry.email)} onChange={() => toggle(entry.email)} className="accent-[#1E1E3F]" />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-[#1E1E3F]">{entry.name}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {[entry.position, entry.company].filter(Boolean).join(' at ') || entry.email}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-400">{entries ? `${entries.length} on the roster` : ''}{ticked.size > 0 ? ` · ${ticked.size} ticked` : ''}</span>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50">
                Close
              </button>
              <button
                onClick={addMet}
                disabled={ticked.size === 0 || saving}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] disabled:opacity-50"
              >
                {saving ? 'Adding…' : `Add ${ticked.size || ''} as met`}
              </button>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
