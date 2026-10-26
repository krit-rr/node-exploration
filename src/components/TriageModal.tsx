'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Contact } from '@/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  eventName: string;
  contacts: Contact[];
  onSave: (updated: Contact) => void;
}

// The two decisions that matter the morning after an event.
const QUICK_TAGS = ['follow-up', 'key-contact'];

/**
 * Post-event triage: step through everyone met at an event once, while the
 * faces are still attached to the names. Each card takes a note and tags;
 * untouched contacts come first since they need triage most.
 */
export default function TriageModal({ isOpen, onClose, eventName, contacts, onSave }: Props) {
  const [queue, setQueue] = useState<Contact[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [note, setNote] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      // Snapshot on open so saves do not reshuffle the deck mid-triage.
      const untouchedFirst = [...contacts].sort(
        (a, b) =>
          Number(Boolean((a.tags?.length ?? 0) > 0 || a.notes)) -
          Number(Boolean((b.tags?.length ?? 0) > 0 || b.notes))
      );
      setQueue(untouchedFirst);
      setIndex(0);
      setSavedCount(0);
      setTagDraft('');
      setNote('');
    }
    wasOpen.current = isOpen;
  }, [isOpen, contacts]);

  const current: Contact | undefined = queue[index];

  useEffect(() => {
    setSelectedTags(current?.tags ?? []);
  }, [current]);

  const advance = () => {
    setIndex(i => i + 1);
    setTagDraft('');
    setNote('');
  };

  const saveAndNext = () => {
    if (!current) return;
    const extraTags = tagDraft.split(',').map(t => t.trim()).filter(Boolean);
    const tags = [...new Set([...selectedTags, ...extraTags])];
    const trimmedNote = note.trim();
    const notes = trimmedNote
      ? (current.notes ? `${current.notes}\n${trimmedNote}` : trimmedNote)
      : (current.notes ?? '');
    const changed = Boolean(trimmedNote) || JSON.stringify(tags) !== JSON.stringify(current.tags ?? []);
    if (changed) {
      onSave({ ...current, tags, notes });
      setSavedCount(c => c + 1);
    }
    advance();
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const field = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20 focus:border-[#1E1E3F] text-sm";
  const tagOptions = [...new Set([...QUICK_TAGS, ...selectedTags])];
  const done = queue.length > 0 && index >= queue.length;

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
          <div className="flex items-baseline justify-between mb-1">
            <Dialog.Title className="text-lg font-semibold text-[#1E1E3F]">Triage: {eventName}</Dialog.Title>
            {!done && queue.length > 0 && (
              <span className="text-sm text-gray-400">{Math.min(index + 1, queue.length)} of {queue.length}</span>
            )}
          </div>

          {done || !current ? (
            <div className="py-6 text-center">
              <p className="text-base text-[#1E1E3F] font-medium mb-1">
                {queue.length === 0 ? 'No one to triage yet' : 'Triage complete'}
              </p>
              <p className="text-sm text-gray-500 mb-5">
                {queue.length === 0
                  ? 'Import or add contacts from this event first.'
                  : `Updated ${savedCount} of ${queue.length} contacts from ${eventName}.`}
              </p>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">Add the context now, while you still remember the conversation.</p>
              <div className="border border-gray-100 bg-gray-50 rounded-lg p-3 mb-3">
                <div className="font-medium text-[#1E1E3F]">{current.name}</div>
                <div className="text-sm text-gray-500">
                  {[current.company, current.industry].filter(Boolean).join(' · ') || current.email}
                </div>
                {current.notes && (
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2">{current.notes}</div>
                )}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); saveAndNext(); }} className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {tagOptions.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        selectedTags.includes(tag)
                          ? 'bg-[#1E1E3F] text-white border-[#1E1E3F]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#1E1E3F]/40'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <input
                  className={field}
                  placeholder="More tags, comma separated"
                  value={tagDraft}
                  onChange={e => setTagDraft(e.target.value)}
                />
                <textarea
                  className={field}
                  placeholder="Note to self: what you talked about, what you owe them"
                  rows={2}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-between items-center pt-1">
                  <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                    Finish later
                  </button>
                  <div className="flex gap-2">
                    <button type="button" onClick={advance} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
                      Skip
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors"
                    >
                      Save and next
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
