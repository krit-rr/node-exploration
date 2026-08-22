import pLimit from 'p-limit';
import { enrichViaAI, isPersonalDomain, type Enrichment } from './enrichViaAI';

type Contact = {
  id: string;
  email: string;
};

type EnrichedContact<T extends Contact> = T & {
  company: string | null;
  industry: string | null;
  enrichedBy: 'ai';
};

// Known domain mappings for fallback
const KNOWN_DOMAINS = new Map<string, Enrichment>([
  ['fcps.edu', { company: 'Fairfax County Public Schools', industry: 'Education' }],
  // Add more known domains as needed
]);

/**
 * Process-wide domain cache. A domain's company/industry is not user-specific,
 * so it's shared across requests and users. Entries expire so a bad answer
 * doesn't stick forever. Survives for the lifetime of the server process;
 * on serverless platforms that means "per warm instance", which is still a
 * large win over re-querying on every request.
 */
const DOMAIN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const domainCache = new Map<string, { value: Enrichment; expiresAt: number }>();

function readCache(domain: string): Enrichment | undefined {
  const hit = domainCache.get(domain);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    domainCache.delete(domain);
    return undefined;
  }
  return hit.value;
}

function writeCache(domain: string, value: Enrichment): void {
  domainCache.set(domain, { value, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const EMPTY: Enrichment = { company: null, industry: null };

async function enrichDomain(
  domain: string,
  sampleEmail: string,
  { maxRetries, cacheByDomain }: { maxRetries: number; cacheByDomain: boolean }
): Promise<Enrichment> {
  if (!domain || isPersonalDomain(domain)) return EMPTY;

  const known = KNOWN_DOMAINS.get(domain);
  if (known) return known;

  if (cacheByDomain) {
    const cached = readCache(domain);
    if (cached) return cached;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const enrichment = await enrichViaAI(sampleEmail);
      if (cacheByDomain) writeCache(domain, enrichment);
      return enrichment;
    } catch (err) {
      const last = attempt === maxRetries;
      console.error(
        `Failed to enrich domain ${domain} (attempt ${attempt + 1}/${maxRetries + 1})${last ? ' - giving up' : ''}`,
        err instanceof Error ? err.message : err
      );
      if (!last) await sleep(2 ** attempt * 300); // Exponential backoff
    }
  }

  // Deliberately not cached: a transient failure shouldn't poison the cache.
  return EMPTY;
}

/**
 * Enrich a list of contacts with company/industry, one AI call per unique
 * domain. Output preserves the input order.
 */
export async function enrichBatchViaAI<T extends Contact>(
  contacts: T[],
  {
    delayMs = 200,
    maxRetries = 2,
    cacheByDomain = true,
    concurrency = 3,
  }: {
    delayMs?: number;
    maxRetries?: number;
    cacheByDomain?: boolean;
    concurrency?: number;
    /** @deprecated No longer used; the domain cache is shared server-side. */
    userEmail?: string | null;
  } = {}
): Promise<EnrichedContact<T>[]> {
  const limit = pLimit(concurrency);

  const domains = new Set<string>();
  const domainOf = (c: Contact) => c.email.split('@')[1]?.toLowerCase() ?? '';
  contacts.forEach((c) => domains.add(domainOf(c)));

  const enrichments = new Map<string, Enrichment>();
  await Promise.all(
    Array.from(domains).map((domain) =>
      limit(async () => {
        const sample = contacts.find((c) => domainOf(c) === domain)!;
        const result = await enrichDomain(domain, sample.email, { maxRetries, cacheByDomain });
        enrichments.set(domain, result);
        // Only pace actual API traffic; cache hits/personal domains are free.
        if (delayMs > 0 && !isPersonalDomain(domain) && !KNOWN_DOMAINS.has(domain)) {
          await sleep(delayMs);
        }
      })
    )
  );

  return contacts.map((contact) => {
    const enrichment = enrichments.get(domainOf(contact)) ?? EMPTY;
    return {
      ...contact,
      company: enrichment.company,
      industry: enrichment.industry,
      enrichedBy: 'ai' as const,
    };
  });
}
