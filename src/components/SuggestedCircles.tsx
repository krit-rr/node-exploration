'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Contact } from '@/types';
import { circleUpdates, dismissCircle, readDismissedCircles, suggestCircles } from '@/utils/circles';
import type { SemanticCircle } from '@/utils/semanticCircles';

/** Sixty vector lookups and a few model calls per request: ask once per visit, not once per mount. */
const STALE_MS = 10 * 60 * 1000;

async function fetchSemanticCircles(): Promise<SemanticCircle[]> {
  const response = await fetch('/api/circles/semantic', { method: 'POST' });
  if (!response.ok) throw new Error(`Semantic circles request failed: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.circles) ? (body.circles as SemanticCircle[]) : [];
}

/** One card shape for both kinds of circle. */
type Card = { key: string; name: string; members: string[]; detail: string; kind: 'mail' | 'alike' };

function jaccard(a: string[], b: string[]): number {
  const setB = new Set(b);
  let common = 0;
  for (const m of a) if (setB.has(m)) common++;
  return common / (a.length + b.length - common);
}

interface Props {
  contacts: Contact[];
  groups: { id: string; name: string; members: string[] }[];
  userEmail?: string | null;
  /** Keep a circle: the page creates the group and switches to it. */
  onCreateGroup: (name: string, members: Set<string>) => void;
  /** A kept circle grew: add the newcomers to the group. */
  onAddToGroup?: (groupId: string, members: string[]) => void;
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
export default function SuggestedCircles({ contacts, groups, userEmail, onCreateGroup, onAddToGroup }: Props) {
  // Groups that grew: newcomers on the group's emails this month, offered once per visit.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const updates = useMemo(() => circleUpdates(contacts, groups), [contacts, groups]);
  const visibleUpdates = updates.filter(u => !skipped.has(`${u.groupId}:${u.newcomers.join(',')}`));
  // Read with the user known, in the same render as the cards, so a dismissed circle never flashes.
  const [dismissedVersion, setDismissedVersion] = useState(0);
  const dismissed = useMemo(
    () => (userEmail ? readDismissedCircles(userEmail) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userEmail, dismissedVersion]
  );

  // Dismissed circles are filtered before the cut to four, so the next-strongest circle takes the slot.
  const suggestions = useMemo(
    () => suggestCircles(contacts, groups, { limit: 4, dismissed }),
    [contacts, groups, dismissed]
  );
  // Circles of alike profiles, from the embeddings: the same dismissals apply, give or take a member.
  const { data: alike = [] } = useQuery({
    queryKey: ['semantic-circles', userEmail],
    queryFn: fetchSemanticCircles,
    enabled: Boolean(userEmail),
    staleTime: STALE_MS,
    retry: false,
  });
  const cards = useMemo<Card[]>(() => {
    // A circle that is a kept group plus its newcomers is offered as an update, not as a new circle.
    const grown = visibleUpdates.map(u => [...u.members, ...u.newcomers]);
    const fromMail: Card[] = suggestions.filter(circle => !grown.some(g => jaccard(g, circle.members) >= 0.6)).map(circle => ({
      key: circle.key,
      name: circle.name,
      members: circle.members,
      detail: `${circle.members.length} people · together on ${circle.messages} email${circle.messages === 1 ? '' : 's'} · last ${ago(circle.lastSeen)}`,
      kind: 'mail',
    }));
    const fromProfiles: Card[] = alike
      .filter(circle => !dismissed.some(d => jaccard(d, circle.members) >= 0.6))
      .filter(circle => !fromMail.some(card => jaccard(card.members, circle.members) >= 0.6))
      .map(circle => ({
        key: `alike-${circle.key}`,
        name: circle.name,
        members: circle.members,
        detail: `${circle.members.length} people · alike profiles, ${Math.round(circle.cohesion * 100)}% close`,
        kind: 'alike',
      }));
    return [...fromMail, ...fromProfiles].slice(0, 8);
  }, [suggestions, alike, dismissed, visibleUpdates]);
  const namesByEmail = useMemo(
    () => new Map(contacts.map(c => [c.email.toLowerCase(), c.name || c.email])),
    [contacts]
  );

  if (cards.length === 0 && visibleUpdates.length === 0) return null;

  const dismiss = (members: string[]) => {
    if (userEmail) dismissCircle(userEmail, members);
    setDismissedVersion(v => v + 1);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      {visibleUpdates.length > 0 && (
        <div className="mb-4 space-y-2">
          {visibleUpdates.slice(0, 3).map(update => {
            const key = `${update.groupId}:${update.newcomers.join(',')}`;
            const names = update.newcomers.map(m => namesByEmail.get(m) ?? m);
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#F4F4FF] px-3 py-2 text-sm text-[#1E1E3F]">
                <span className="flex-1 min-w-0">
                  {names.length === 1 ? `${names[0]} has` : `${names.length} people have`} been on <span className="font-medium">{update.groupName}</span>&rsquo;s emails this month but {names.length === 1 ? 'is' : 'are'} not in the group{names.length > 1 ? `: ${names.join(', ')}` : ''}.
                </span>
                {onAddToGroup && (
                  <button
                    onClick={() => { onAddToGroup(update.groupId, update.newcomers); setSkipped(prev => new Set(prev).add(key)); }}
                    className="text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                  >
                    Add {names.length === 1 ? 'them' : 'all'}
                  </button>
                )}
                <button
                  onClick={() => setSkipped(prev => new Set(prev).add(key))}
                  className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-white transition-colors"
                >
                  Not now
                </button>
              </div>
            );
          })}
        </div>
      )}
      {cards.length === 0 ? null : (
      <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-[#1E1E3F]">Circles you already have</h2>
        <p className="text-sm text-gray-500">People you keep emailing together, and people whose profiles are alike. Keep one as a group, or dismiss it.</p>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(circle => (
          <div key={circle.key} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-1.5 min-w-0">
            <p className="font-medium text-[#1E1E3F] truncate">{circle.name}</p>
            <p className="text-xs text-gray-400">{circle.detail}</p>
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
                onClick={() => dismiss(circle.members)}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
                title="Not a circle; do not suggest it again"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
