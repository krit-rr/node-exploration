'use client';

import { useEffect, useState } from 'react';

export interface SemanticMatch {
  contact_email: string;
  content: string;
  similarity: number;
}

/**
 * Debounced semantic contact search against /api/search.
 *
 * Only fires while `enabled` is true (the contacts page enables it as a
 * fallback when the literal text filter finds nothing), so typing a query
 * that keyword search already satisfies costs no embedding calls.
 */
export function useSemanticSearch(query: string, enabled: boolean) {
  const [matches, setMatches] = useState<SemanticMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 3) {
      setMatches(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&limit=25`
        );
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);
        const data = await response.json();
        if (!cancelled) setMatches(data.results ?? []);
      } catch {
        if (!cancelled) setMatches(null);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return { matches, isSearching };
}
