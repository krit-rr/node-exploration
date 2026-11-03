'use client';

import { useEffect, useMemo, useState } from 'react';
import { Contact } from '@/types';
import { dismissCircle, readDismissedCircles, suggestCircles } from '@/utils/circles';

interface Props {
  contacts: Contact[];
  groups: { id: string; name: string; members: string[] }[];
  userEmail?: string | null;
  /** Keep a circle: the page creates the group and switches to it. */
  onCreateGroup: (name: string, members: Set<string>) => void;
}

function ago(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days < 1) return 'today';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * The groups the mail already implies: people who keep landing on the same
 * emails. One tap keeps a circle as a real group; dismissing it is final.
 */
export default function SuggestedCircles({ contacts, groups, userEmail, onCreateGroup }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (userEmail) setDismissed(readDismissedCircles(userEmail));
  }, [userEmail]);

  const suggestions = useMemo(
    () => suggestCircles(contacts, groups, { limit: 4 }).filter(circle => !dismissed.has(circle.key)),
    [contacts, groups, dismissed]
  );
  const namesByEmail = useMemo(
    () => new Map(contacts.map(c => [c.email.toLowerCase(), c.name || c.email])),
    [contacts]
  );

  if (suggestions.length === 0) return null;

  const dismiss = (key: string) => {
    setDismissed(prev => new Set(prev).add(key));
    if (userEmail) dismissCircle(userEmail, key);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-[#1E1E3F]">Circles you already have</h2>
        <p className="text-sm text-gray-500">People you keep emailing together. Keep one as a group, or dismiss it.</p>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {suggestions.map(circle => (
          <div key={circle.key} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1.5 min-w-0">
            <p className="font-medium text-[#1E1E3F] truncate">{circle.name}</p>
            <p className="text-xs text-gray-400">
              {circle.members.length} people &middot; together on {circle.messages} email{circle.messages === 1 ? '' : 's'} &middot; last {ago(circle.lastSeen)}
            </p>
            <p className="text-xs text-gray-500 line-clamp-2">
              {circle.members.map(member => namesByEmail.get(member) ?? member).join(', ')}
            </p>
            <div className="flex items-center gap-2 mt-auto pt-1">
              <button
                onClick={() => onCreateGroup(circle.name, new Set(circle.members))}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
              >
                Make a group
              </button>
              <button
                onClick={() => dismiss(circle.key)}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                title="Not a circle; do not suggest it again"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
