'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Contact } from '@/types';
import { DuplicatePair } from '@/utils/duplicates';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pairs to review; the parent removes a pair once merged or dismissed. */
  pairs: DuplicatePair[];
  onMerge: (primary: Contact, duplicate: Contact) => Promise<void>;
  /** "Not the same person": remember the decision and stop suggesting it. */
  onDismiss: (pair: DuplicatePair) => void;
}

const formatDate = (iso?: string): string => {
  if (!iso) return 'Never';
  const date = new Date(iso);
  return isNaN(date.getTime()) ? 'Never' : date.toLocaleDateString();
};

function ContactCard({
  contact,
  isPrimary,
  onKeep,
}: {
  contact: Contact;
  isPrimary: boolean;
  onKeep: () => void;
}) {
  return (
    <div
      className={`flex-1 rounded-lg border p-3 text-left ${
        isPrimary ? 'border-[#1E1E3F] bg-[#F4F4FF]' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-sm text-[#1E1E3F] truncate">{contact.name}</span>
        {isPrimary ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#1E1E3F] bg-[#1E1E3F]/10 px-1.5 py-0.5 rounded">
            Keeps
          </span>
        ) : (
          <button
            onClick={onKeep}
            className="text-[10px] font-medium text-gray-500 hover:text-[#1E1E3F] underline underline-offset-2"
          >
            Keep this one
          </button>
        )}
      </div>
      <div className="text-xs text-gray-600 truncate">{contact.email}</div>
      <dl className="mt-2 space-y-1 text-xs text-gray-500">
        <div className="flex justify-between gap-2">
          <dt>Company</dt>
          <dd className="text-gray-700 truncate">{contact.company || 'Unknown'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Last contacted</dt>
          <dd className="text-gray-700">{formatDate(contact.lastContacted)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Tags</dt>
          <dd className="text-gray-700 truncate">
            {contact.tags?.length ? contact.tags.join(', ') : 'None'}
          </dd>
        </div>
        {contact.metAt && (
          <div className="flex justify-between gap-2">
            <dt>Met at</dt>
            <dd className="text-gray-700 truncate">{contact.metAt}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>Notes</dt>
          <dd className="text-gray-700">{contact.notes?.trim() ? 'Yes' : 'None'}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Review likely duplicates one pair at a time. Merging keeps everything:
 * tags, notes, history and the second address itself, so activity on either
 * address keeps landing on the surviving contact.
 */
export default function MergeModal({ isOpen, onClose, pairs, onMerge, onDismiss }: Props) {
  const [index, setIndex] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIndex(0);
      setSwapped(false);
    }
  }, [isOpen]);

  const safeIndex = Math.min(index, Math.max(pairs.length - 1, 0));
  const pair = pairs[safeIndex];
  const primary = pair ? (swapped ? pair.duplicate : pair.primary) : null;
  const duplicate = pair ? (swapped ? pair.primary : pair.duplicate) : null;

  const advance = () => setSwapped(false);

  const handleMerge = async () => {
    if (!primary || !duplicate || merging) return;
    setMerging(true);
    try {
      await onMerge(primary, duplicate);
      advance();
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={merging ? () => {} : onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6">
          <Dialog.Title className="text-lg font-semibold text-[#1E1E3F] mb-1">
            Merge duplicates
          </Dialog.Title>
          {pair && primary && duplicate ? (
            <>
              <p className="text-sm text-gray-500 mb-4">
                These two look like the same person ({pair.reason}). Merging keeps both
                addresses, all tags, notes and history on one contact.
                {pairs.length > 1 && (
                  <span className="text-gray-400"> {safeIndex + 1} of {pairs.length}</span>
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <ContactCard contact={primary} isPrimary onKeep={() => {}} />
                <ContactCard
                  contact={duplicate}
                  isPrimary={false}
                  onKeep={() => setSwapped((s) => !s)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
                <button
                  onClick={() => {
                    onDismiss(pair);
                    advance();
                  }}
                  disabled={merging}
                  className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 transition-colors"
                >
                  Not the same person
                </button>
                <div className="flex items-center gap-2">
                  {pairs.length > 1 && (
                    <button
                      onClick={() => {
                        setIndex((safeIndex + 1) % pairs.length);
                        advance();
                      }}
                      disabled={merging}
                      className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 transition-colors"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    onClick={handleMerge}
                    disabled={merging}
                    className="px-4 py-2 text-sm font-medium bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] disabled:opacity-50 transition-colors"
                  >
                    {merging ? 'Merging…' : `Merge into ${primary.name || primary.email}`}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">
                No duplicates left to review. Nice and tidy.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
