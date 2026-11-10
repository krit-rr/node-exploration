'use client';

import { useMemo } from 'react';
import type { Contact } from '@/types';
import GroupMembers from '@/components/insights/GroupMembers';
import { safeFormatDate } from '@/utils/dates';
import { introducerChains, places, whenMet } from '@/utils/whereAndWhen';

interface Props {
  contacts: Contact[];
  onGroupCreate: (name: string, members: Set<string>) => void;
}

const SHOW = 8;

/**
 * Place, time and introducer as views: where you met people, when, and who
 * brought whom. Each card opens to its people and can become a group in
 * one tap, so "everyone from Climate Week" is a group without typing names.
 */
export default function WhereAndWhen({ contacts, onGroupCreate }: Props) {
  const where = useMemo(() => places(contacts), [contacts]);
  const when = useMemo(() => whenMet(contacts), [contacts]);
  const chains = useMemo(() => introducerChains(contacts), [contacts]);
  if (where.length === 0 && when.length === 0 && chains.length === 0) return null;

  return (
    <div className="space-y-8">
      {where.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#1E1E3F]">Where you met people</h3>
          <div className="space-y-3">
            {where.slice(0, SHOW).map(place => (
              <GroupMembers
                key={place.name}
                title={place.name}
                members={place.members}
                contacts={contacts}
                description={`${place.members.size} ${place.members.size === 1 ? 'person' : 'people'}${place.latest ? `, newest ${safeFormatDate(new Date(place.latest).toISOString(), 'MMM yyyy', '')}` : ''}`}
                onCreateGroup={onGroupCreate}
              />
            ))}
          </div>
        </div>
      )}

      {when.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#1E1E3F]">When you met them</h3>
          <div className="space-y-3">
            {when.slice(0, SHOW).map(month => (
              <GroupMembers
                key={month.month}
                title={month.label}
                members={month.members}
                contacts={contacts}
                description={`${month.members.size} ${month.members.size === 1 ? 'person' : 'people'} first known that month`}
                onCreateGroup={onGroupCreate}
              />
            ))}
          </div>
        </div>
      )}

      {chains.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#1E1E3F]">Who brought whom</h3>
          <div className="space-y-3">
            {chains.slice(0, SHOW).map(chain => (
              <GroupMembers
                key={chain.name}
                title={`Through ${chain.name}`}
                members={new Set(chain.reach.map(r => r.contact.email))}
                contacts={contacts}
                description={
                  chain.reach.length > chain.direct.length
                    ? `${chain.direct.length} directly, ${chain.reach.length} within three hops`
                    : `${chain.direct.length} ${chain.direct.length === 1 ? 'person' : 'people'} directly`
                }
                onCreateGroup={onGroupCreate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
