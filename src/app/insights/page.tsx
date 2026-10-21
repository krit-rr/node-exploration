'use client';

import AppLayout from '@/components/Layout/AppLayout';
import { useState } from 'react';
import NetworkScore from '@/components/insights/NetworkScore';
import TimeframeSelector from '@/components/insights/TimeframeSelector';
import RelationshipTimeline from '@/components/insights/RelationshipTimeline';
import SmartInsights from '@/components/insights/SmartInsights';
import { useContacts } from '@/hooks/useContacts';
import ErrorBoundary from '@/components/ErrorBoundary';
import ReconnectRail from '@/components/ReconnectRail';
import toast from 'react-hot-toast';

export default function InsightsPage() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'30d' | '90d' | '1y'>('30d');
  const [currentView, setCurrentView] = useState<'organize' | 'analyze'>('analyze');

  // Same query key, shape, and fetcher as the contacts page, so whichever
  // page loads first primes the cache for the other.
  const { data: contactsData, isLoading, error, refetch } = useContacts();
  const contacts = contactsData?.contacts ?? [];

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

            <div className="space-y-8">
              <ErrorBoundary label="ReconnectRail">
                <ReconnectRail contacts={contacts} onSnoozed={handleSnoozed} compact />
              </ErrorBoundary>

              <ErrorBoundary label="NetworkScore">
                <NetworkScore
                  contacts={contacts}
                  onViewChange={setCurrentView}
                />
              </ErrorBoundary>

              <ErrorBoundary label={currentView === 'organize' ? 'SmartInsights' : 'RelationshipTimeline'}>
                {currentView === 'organize' ? (
                  <SmartInsights
                    contacts={contacts}
                    onGroupCreate={createGroupFromInsight}
                  />
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
