'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { Contact } from '@/types';
import { computeReconnectQueue } from '@/utils/reconnect';
import { digestSubject } from '@/utils/digestSubject';

type Subscription = { subscribed: boolean; persisted: boolean; configured: boolean } | null;

interface Props {
  contacts: Contact[];
  priorityEmails?: Set<string>;
}

/**
 * The Monday digest: one toggle and a preview. The queue only works if
 * it finds you, so the going-cold five can arrive by email every Monday.
 * The sample subject comes from the same queue the rail beside it shows.
 */
export default function DigestSettings({ contacts, priorityEmails }: Props) {
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [saving, setSaving] = useState(false);
  const count = useMemo(
    () => computeReconnectQueue(contacts, { limit: 50, priorityEmails }).length,
    [contacts, priorityEmails]
  );

  useEffect(() => {
    fetch('/api/digest')
      .then(response => (response.ok ? response.json() : null))
      .then(body => body && setSubscription({
        subscribed: Boolean(body.subscribed),
        persisted: Boolean(body.persisted),
        configured: Boolean(body.configured),
      }))
      .catch(() => {});
  }, []);

  if (!subscription) return null;

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    const enabled = !subscription.subscribed;
    try {
      const response = await fetch('/api/digest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      setSubscription({ ...subscription, subscribed: enabled, persisted: Boolean(body.persisted) });
      if (!body.persisted) toast('Not saved: the digest table is not set up yet');
      else toast.success(enabled ? 'You will get the digest on Mondays' : 'Digest turned off');
    } catch {
      toast.error('Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-[#1E1E3F]">Monday digest</p>
        <p className="text-sm text-gray-500">
          The going-cold five, one line of context each, in your inbox every Monday.
          {' '}This week it would say: <span className="italic">{digestSubject(count)}</span>.
          {!subscription.configured && <span className="text-gray-400"> Sending is not configured on this install yet; the preview works.</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-none">
        <a
          href="/api/digest?format=html"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-[#1E1E3F] hover:bg-gray-50 transition-colors"
        >
          Preview
        </a>
        <button
          onClick={toggle}
          disabled={saving}
          className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors disabled:opacity-60 ${
            subscription.subscribed ? 'bg-[#1E1E3F] text-white hover:bg-[#2D2D5F]' : 'border border-gray-200 text-[#1E1E3F] hover:bg-gray-50'
          }`}
          aria-pressed={subscription.subscribed}
        >
          {subscription.subscribed ? 'On, every Monday' : 'Email me on Mondays'}
        </button>
      </div>
    </div>
  );
}
