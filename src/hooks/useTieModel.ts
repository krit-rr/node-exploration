'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { asTieModel, GLOBAL_MODEL, type TieModel } from '@/utils/tieStrength';

async function fetchTieModel(): Promise<TieModel> {
  const response = await fetch('/api/model');
  if (!response.ok) return GLOBAL_MODEL;
  const body = await response.json();
  return asTieModel(body?.model);
}

/** The caller's tie-strength model; the global prior until it has learned, or when nothing is stored. */
export function useTieModel(): TieModel {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const { data = GLOBAL_MODEL } = useQuery({
    queryKey: ['tie-model', userEmail],
    queryFn: fetchTieModel,
    enabled: Boolean(userEmail),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data;
}
