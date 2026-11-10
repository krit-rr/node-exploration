'use client';

import { useEffect, useState } from 'react';
import { safeFormatDate } from '@/utils/dates';

type Reach = { persisted: boolean; cursor: { beforeTime: string | null; messages: number; done: boolean } | null } | null;

/**
 * One line on how much mail the rest of the page is reading from, so a thin
 * rhythm or an empty replay is explained rather than mysterious.
 */
export default function HistoryReach() {
  const [reach, setReach] = useState<Reach>(null);
  useEffect(() => {
    fetch('/api/contacts/backfill')
      .then(response => (response.ok ? response.json() : null))
      .then(body => body && setReach({ persisted: Boolean(body.persisted), cursor: body.cursor ?? null }))
      .catch(() => {});
  }, []);
  if (!reach?.persisted) return null;

  const cursor = reach.cursor;
  const back = cursor?.beforeTime ? safeFormatDate(cursor.beforeTime, 'MMMM yyyy', '') : '';
  const count = cursor ? `${cursor.messages.toLocaleString()} sent email${cursor.messages === 1 ? '' : 's'}` : '';
  const text = !cursor || !back
    ? 'Mail history: the newest hundred sent emails so far. Older mail loads a few pages at a time on each visit.'
    : cursor.done
      ? `Mail history reaches back to ${back} (${count}), as far as Node reads.`
      : `Mail history reaches back to ${back} so far (${count}). Older mail loads a few pages at a time on each visit.`;
  return <p className="text-xs text-gray-400 -mt-6 mb-6">{text}</p>;
}
