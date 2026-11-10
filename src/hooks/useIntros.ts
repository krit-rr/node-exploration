'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { IntroSuggestion } from '@/utils/intros';

/** Thirty vector lookups per request: ask once per visit, not once per mount, and share the answer across pages. */
const STALE_MS = 10 * 60 * 1000;

async function fetchIntros(): Promise<IntroSuggestion[]> {
  const response = await fetch('/api/contacts/intros', { method: 'POST' });
  if (!response.ok) throw new Error(`Intros request failed: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.intros) ? (body.intros as IntroSuggestion[]) : [];
}

/** The introductions worth making, from the shared cache. Empty until the user is known or when the request fails. */
export function useIntros(): IntroSuggestion[] {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const { data = [] } = useQuery({
    queryKey: ['intros', userEmail],
    queryFn: fetchIntros,
    enabled: Boolean(userEmail),
    staleTime: STALE_MS,
    retry: false,
  });
  return data;
}
