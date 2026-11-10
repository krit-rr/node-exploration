'use client';

import AppLayout from '@/components/Layout/AppLayout';
import { useState } from 'react';
import NetworkScore from '@/components/insights/NetworkScore';
import TimeframeSelector from '@/components/insights/TimeframeSelector';
import RelationshipTimeline from '@/components/insights/RelationshipTimeline';
import SmartInsights from '@/components/insights/SmartInsights';
import WhereAndWhen from '@/components/insights/WhereAndWhen';
import { persistContacts, useContacts, type ContactsData } from '@/hooks/useContacts';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { RehearsalEntry } from '@/types';
import { useEffect, useMemo, useRef } from 'react';
import { computeReconnectQueue } from '@/utils/reconnect';
import { firstName } from '@/utils/draft';
import type { NextStep } from '@/components/insights/NetworkScore';
import ErrorBoundary from '@/components/ErrorBoundary';
import ReconnectRail from '@/components/ReconnectRail';
import IntroSuggestions from '@/components/IntroSuggestions';
import DigestSettings from '@/components/DigestSettings';
import HistoryReach from '@/components/HistoryReach';
import AskNetwork from '@/components/AskNetwork';
import OnThisDay from '@/components/OnThisDay';
import RehearsalCard from '@/components/RehearsalCard';
import toast from 'react-hot-toast';

export default function InsightsPage() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'30d' | '90d' | '1y'>('30d');
  const [currentView, setCurrentView] = useState<'organize' | 'analyze'>('analyze');

  // Same query key, shape, and fetcher as the contacts page, so whichever
  // page loads first primes the cache for the other.
  const { data: contactsData, isLoading, error, refetch } = useContacts();
  const contacts = contactsData?.contacts ?? [];
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // An answered name card: keep the new schedule with the contact everywhere.
  const handleRehearsed = (email: string, entry: RehearsalEntry) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const merged = existing.map(c => (c.email.toLowerCase() === email.toLowerCase() ? { ...c, rehearsal: entry } : c));
      return session?.user?.email
        ? persistContacts(session.user.email, merged)
        : { contacts: merged, lastUpdated: new Date().toISOString() };
    });
  };

  // Smart-group clusters become real, account-synced groups.
  const createGroupFromInsight = async (name: string, members: Set<string>) => {
    try {
      const response = await fetch('/api/groups');
      const data = response.ok ? await response.json() : { groups: [] };
      const groups = Array.isArray(data.groups) ? data.groups : [];
      const newGroup = { id: String(Date.now()), name: name.slice(0, 200), members: Array.from(members) };
      const put = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: [...groups, newGroup] }),
      });
      if (!put.ok) throw new Error(String(put.status));
      toast.success(`Group "${newGroup.name}" created`);
    } catch {
      toast.error('Could not create the group');
    }
  };

  const handleSnoozed = () => refetch();
  const handleTouchLogged = () => refetch();

  // The gaps lead somewhere: automated senders leave the queue and the score
  // for good; people who never answer, or went quiet, are snoozed in one go.
  const writeContacts = (next: typeof contacts) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], () =>
      session?.user?.email ? persistContacts(session.user.email, next) : { contacts: next, lastUpdated: new Date().toISOString() }
    );
  };
  const markAutomated = async (emails: string[]) => {
    const set = new Set(emails.map(e => e.toLowerCase()));
    try {
      const response = await fetch('/api/contacts/spam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, isSpam: true }),
      });
      if (!response.ok) throw new Error(String(response.status));
      writeContacts(contacts.map(c => (set.has(c.email.toLowerCase()) ? { ...c, isSpam: true } : c)));
      toast.success(`${emails.length} ${emails.length === 1 ? 'sender' : 'senders'} marked as automated`);
    } catch {
      toast.error('Could not mark them right now');
    }
  };
  const snoozeAll = async (emails: string[], days: number) => {
    const results = await Promise.allSettled(
      emails.map(email =>
        fetch('/api/contacts/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, days }),
        }).then(response => {
          if (!response.ok) throw new Error(String(response.status));
          return email.toLowerCase();
        })
      )
    );
    const snoozed = new Set(results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : [])));
    if (snoozed.size > 0) {
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      writeContacts(contacts.map(c => (snoozed.has(c.email.toLowerCase()) ? { ...c, snoozedUntil: until } : c)));
    }
    if (snoozed.size === emails.length) toast.success(`Snoozed ${snoozed.size} for ${days} days`);
    else if (snoozed.size > 0) toast(`Snoozed ${snoozed.size} of ${emails.length}; the rest did not save`);
    else toast.error('Could not snooze them right now');
  };

  // Group members count as priority alongside key-contact tagged contacts.
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  useEffect(() => {
    fetch('/api/groups')
      .then(r => (r.ok ? r.json() : { groups: [] }))
      .then(data => setGroupMembers(
        (Array.isArray(data.groups) ? data.groups : []).flatMap((g: { members?: string[] }) => g.members ?? [])
      ))
      .catch(() => {});
  }, []);

  const priorityEmails = useMemo(
    () => new Set<string>(groupMembers.map(m => m.toLowerCase())),
    [groupMembers]
  );

  // The one thing the score points at: the people furthest past their rhythm, with the rail one click away.
  const railRef = useRef<HTMLDivElement>(null);
  const nextStep = useMemo<NextStep | undefined>(() => {
    const queue = computeReconnectQueue(contacts, { limit: 3, priorityEmails });
    if (queue.length > 0) {
      const names = queue.map(c => firstName(c.contact.name, c.contact.email));
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return {
        text: `${list} ${names.length === 1 ? 'is' : 'are'} the furthest past ${names.length === 1 ? 'their' : 'their own'} rhythm. An opener is one tap away.`,
        label: 'Open the rail',
        onClick: () => railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      };
    }
    if (contacts.length > 0 && priorityEmails.size === 0 && !contacts.some(c => (c.tags ?? []).some(t => t.toLowerCase() === 'key-contact'))) {
      return {
        text: 'Nobody is marked as mattering yet. Tag a few people key-contact or make a group, and the score measures them.',
        label: 'Organize',
        onClick: () => setCurrentView('organize'),
      };
    }
    return contacts.length > 0 ? { text: 'Nothing is going cold right now.' } : undefined;
  }, [contacts, priorityEmails]);

  const goingColdCount = useMemo(
    () => computeReconnectQueue(contacts, { limit: 50, priorityEmails }).length,
    [contacts, priorityEmails]
  );

  // AppLayout renders unconditionally: it owns the auth gate, so an early
  // return here would leave signed-out visitors on a spinner forever.
  return (
    <AppLayout>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="flex-1 transition-all duration-200">
          <div className="max-w-[1400px] mx-auto py-8 px-6">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-[#1E1E3F]">Network Analytics</h1>
              <TimeframeSelector selected={selectedTimeframe} onChange={setSelectedTimeframe} />
            </div>

            <ErrorBoundary label="HistoryReach">
              <HistoryReach />
            </ErrorBoundary>

            <div className="space-y-8">
              <ErrorBoundary label="ReconnectRail">
                <div ref={railRef} className="scroll-mt-6" />
                <ReconnectRail
                  contacts={contacts}
                  onSnoozed={handleSnoozed}
                  onTouchLogged={handleTouchLogged}
                  priorityEmails={priorityEmails}
                  compact
                />
              </ErrorBoundary>

              <ErrorBoundary label="OnThisDay">
                <OnThisDay contacts={contacts} />
              </ErrorBoundary>

              <ErrorBoundary label="AskNetwork">
                <AskNetwork />
              </ErrorBoundary>

              <ErrorBoundary label="DigestSettings">
                <DigestSettings contacts={contacts} priorityEmails={priorityEmails} />
              </ErrorBoundary>

              <ErrorBoundary label="IntroSuggestions">
                <IntroSuggestions />
              </ErrorBoundary>

              <ErrorBoundary label="RehearsalCard">
                <RehearsalCard contacts={contacts} onRecorded={handleRehearsed} />
              </ErrorBoundary>

              <ErrorBoundary label="NetworkScore">
                <NetworkScore
                  contacts={contacts}
                  priorityEmails={priorityEmails}
                  goingColdCount={goingColdCount}
                  onViewChange={setCurrentView}
                  nextStep={nextStep}
                />
              </ErrorBoundary>

              <ErrorBoundary label={currentView === 'organize' ? 'SmartInsights' : 'RelationshipTimeline'}>
                {currentView === 'organize' ? (
                  <div className="space-y-8">
                    <WhereAndWhen contacts={contacts} onGroupCreate={createGroupFromInsight} />
                    <SmartInsights
                      contacts={contacts}
                      onGroupCreate={createGroupFromInsight}
                      onMarkAutomated={markAutomated}
                      onSnoozeAll={snoozeAll}
                    />
                  </div>
                ) : (
                  <RelationshipTimeline
                    contacts={contacts}
                    timeframe={selectedTimeframe}
                    isExpanded={true}
                    onToggleExpand={() => {}}
                  />
                )}
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

const LoadingState = () => (
  <div className="flex-1 flex items-center justify-center py-32">
    <div className="space-y-4 text-center">
      <div className="w-16 h-16 border-4 border-[#1E1E3F] border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-gray-600">Analyzing your network...</p>
    </div>
  </div>
);

const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex-1 flex items-center justify-center py-32">
    <div className="space-y-4 text-center">
      <p className="text-gray-600">We couldn&apos;t load your network data.</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm font-medium text-white bg-[#1E1E3F] rounded-lg hover:bg-[#2D2D5F] transition-colors"
      >
        Try again
      </button>
    </div>
  </div>
);
