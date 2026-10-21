import { getSupabaseAdmin } from './supabaseAdmin';
import { Contact } from '@/types';

/**
 * Server-side contact repository (Supabase, service-role only).
 *
 * The store is the durable source of truth; provider syncs MERGE into it so
 * user edits, CSV imports, enrichment, and contacts older than the last 100
 * sent emails all survive a refresh. Until the contacts migration has been
 * applied, every helper reports `available: false` and callers fall back to
 * the old stateless behavior.
 */

type ContactRow = {
  id: string;
  owner_email: string;
  email: string;
  name: string;
  company: string | null;
  industry: string | null;
  last_contacted: string | null;
  interactions: unknown;
  custom_fields: unknown;
  tags: unknown;
  notes: string;
  is_spam: boolean;
  source: string | null;
  enriched_by: string | null;
  met_at: string | null;
  snoozed_until: string | null;
};

// Postgres error codes for "relation does not exist" / RLS-off states we
// treat as "store not provisioned yet".
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST116']);

export function isMissingStore(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /relation .*contacts.* does not exist|Could not find the table/i.test(error.message ?? '');
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// The reconnect migration adds met_at / snoozed_until. Until a database has
// it, PostgREST rejects writes naming those columns (PGRST204 / 42703);
// strip them and retry so core persistence keeps working pre-migration.
const NEW_COLUMNS = ['met_at', 'snoozed_until'] as const;

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') {
    return NEW_COLUMNS.some((c) => (error.message ?? '').includes(c));
  }
  return false;
}

function stripNewColumns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const column of NEW_COLUMNS) delete (copy as Record<string, unknown>)[column];
  return copy;
}

export function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name || row.email,
    email: row.email,
    lastContacted: row.last_contacted ?? '',
    sentDates: asArray(row.interactions)
      .map((i) => (i as { date?: string }).date)
      .filter((d): d is string => !!d),
    interactions: asArray(row.interactions) as Contact['interactions'],
    company: row.company ?? undefined,
    industry: row.industry ?? undefined,
    customFields: asArray(row.custom_fields) as Contact['customFields'],
    tags: asArray(row.tags) as string[],
    notes: row.notes || '',
    provider: (row.source === 'google' || row.source === 'microsoft-entra-id'
      ? row.source
      : undefined) as Contact['provider'],
    enrichedBy: row.enriched_by === 'ai' ? 'ai' : undefined,
    metAt: row.met_at ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    ...(row.is_spam ? { isSpam: true } : {}),
  } as Contact;
}

export async function listContacts(
  owner: string
): Promise<{ available: boolean; contacts: Contact[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('owner_email', owner)
    .order('last_contacted', { ascending: false, nullsFirst: false });

  if (error) {
    if (isMissingStore(error)) return { available: false, contacts: [] };
    throw new Error(`Failed to list contacts: ${error.message}`);
  }
  return { available: true, contacts: (data as ContactRow[]).map(rowToContact) };
}

/**
 * Merge provider-derived contacts into the store.
 *
 * Provider data wins on recency (lastContacted, interactions); stored user
 * data wins on identity and intent (name edits, company/industry enrichment,
 * custom fields, tags, notes, spam flags). Rows the provider no longer
 * returns are left untouched.
 */
export async function mergeProviderContacts(
  owner: string,
  provider: 'google' | 'microsoft-entra-id',
  incoming: Contact[]
): Promise<{ available: boolean }> {
  if (incoming.length === 0) return { available: true };
  const supabase = getSupabaseAdmin();

  const { data: existingRows, error: readError } = await supabase
    .from('contacts')
    .select('email, name, company, industry, last_contacted, is_spam, notes')
    .eq('owner_email', owner);
  if (readError) {
    if (isMissingStore(readError)) return { available: false };
    throw new Error(`Failed to read contacts for merge: ${readError.message}`);
  }
  const existing = new Map(
    (existingRows as Pick<ContactRow, 'email' | 'name' | 'company' | 'industry' | 'last_contacted' | 'is_spam' | 'notes'>[]).map(
      (r) => [r.email, r]
    )
  );

  const now = new Date().toISOString();
  const rows = incoming.map((contact) => {
    const email = contact.email.toLowerCase();
    const prior = existing.get(email);
    return {
      owner_email: owner,
      email,
      // A stored name is a user-visible identity the user may have edited;
      // only fill it from the provider when we have nothing.
      name: prior?.name || contact.name || email,
      company: contact.company ?? prior?.company ?? null,
      industry: contact.industry ?? prior?.industry ?? null,
      last_contacted: contact.lastContacted || prior?.last_contacted || null,
      interactions: contact.interactions ?? [],
      source: provider,
      enriched_by: contact.enrichedBy ?? null,
      updated_at: now,
    };
  });

  const { error } = await supabase
    .from('contacts')
    .upsert(rows, { onConflict: 'owner_email,email' });
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to merge provider contacts: ${error.message}`);
  }
  return { available: true };
}

/** Upsert CSV-imported contacts; never clobbers existing enrichment. */
export async function upsertImportedContacts(
  owner: string,
  incoming: Contact[]
): Promise<{ available: boolean }> {
  if (incoming.length === 0) return { available: true };
  const now = new Date().toISOString();
  const rows = incoming.map((contact) => ({
    owner_email: owner,
    email: contact.email.toLowerCase(),
    name: contact.name || contact.email,
    company: contact.company ?? null,
    industry: contact.industry ?? null,
    last_contacted: contact.lastContacted || null,
    custom_fields: contact.customFields ?? [],
    tags: contact.tags ?? [],
    notes: contact.notes ?? '',
    met_at: contact.metAt ?? null,
    source: (contact as Contact & { source?: string }).source ?? 'csv_import',
    enriched_by: contact.enrichedBy ?? null,
    updated_at: now,
  }));

  let { error } = await getSupabaseAdmin()
    .from('contacts')
    .upsert(rows, { onConflict: 'owner_email,email', ignoreDuplicates: false });
  if (error && isMissingColumn(error)) {
    ({ error } = await getSupabaseAdmin()
      .from('contacts')
      .upsert(rows.map(stripNewColumns), { onConflict: 'owner_email,email', ignoreDuplicates: false }));
  }
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to upsert imported contacts: ${error.message}`);
  }
  return { available: true };
}

/**
 * Update one contact, addressed by its ORIGINAL email (the route param), so
 * an email edit updates the row in place instead of forking a duplicate.
 */
export async function updateContact(
  owner: string,
  originalEmail: string,
  updated: Contact
): Promise<{ available: boolean; contact: Contact | null }> {
  const supabase = getSupabaseAdmin();
  const patch = {
    email: updated.email.toLowerCase(),
    name: updated.name,
    company: updated.company ?? null,
    industry: updated.industry ?? null,
    last_contacted: updated.lastContacted || null,
    custom_fields: updated.customFields ?? [],
    tags: updated.tags ?? [],
    notes: updated.notes ?? '',
    met_at: updated.metAt ?? null,
    is_spam: Boolean(updated.isSpam),
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabase
    .from('contacts')
    .update(patch)
    .eq('owner_email', owner)
    .eq('email', originalEmail.toLowerCase())
    .select('*');
  if (error && isMissingColumn(error)) {
    ({ data, error } = await supabase
      .from('contacts')
      .update(stripNewColumns(patch))
      .eq('owner_email', owner)
      .eq('email', originalEmail.toLowerCase())
      .select('*'));
  }

  if (error) {
    if (isMissingStore(error)) return { available: false, contact: null };
    throw new Error(`Failed to update contact: ${error.message}`);
  }
  if (!data || data.length === 0) {
    // Contact not in the store yet (e.g. pre-migration localStorage data):
    // create it so the edit survives.
    const { data: inserted, error: insertError } = await supabase
      .from('contacts')
      .upsert([{ owner_email: owner, ...patch }], { onConflict: 'owner_email,email' })
      .select('*');
    if (insertError) {
      if (isMissingStore(insertError)) return { available: false, contact: null };
      throw new Error(`Failed to create contact: ${insertError.message}`);
    }
    return { available: true, contact: rowToContact(inserted![0] as ContactRow) };
  }
  return { available: true, contact: rowToContact(data[0] as ContactRow) };
}

/** Stored contacts that have no company yet (enrichment candidates). */
export async function listUnenriched(
  owner: string,
  max: number
): Promise<{ available: boolean; contacts: Contact[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('owner_email', owner)
    .is('company', null)
    .limit(max);
  if (error) {
    if (isMissingStore(error)) return { available: false, contacts: [] };
    throw new Error(`Failed to list unenriched contacts: ${error.message}`);
  }
  return { available: true, contacts: (data as ContactRow[]).map(rowToContact) };
}

/** Write enrichment results back onto stored rows. */
export async function applyEnrichment(
  owner: string,
  results: { email: string; company: string | null; industry: string | null }[]
): Promise<{ available: boolean; updated: number }> {
  let updated = 0;
  for (const result of results) {
    if (!result.company && !result.industry) continue;
    const { error } = await getSupabaseAdmin()
      .from('contacts')
      .update({
        company: result.company,
        industry: result.industry,
        enriched_by: 'ai',
        updated_at: new Date().toISOString(),
      })
      .eq('owner_email', owner)
      .eq('email', result.email.toLowerCase());
    if (error) {
      if (isMissingStore(error)) return { available: false, updated };
      throw new Error(`Failed to apply enrichment: ${error.message}`);
    }
    updated++;
  }
  return { available: true, updated };
}

/** Snooze (or clear: until=null) a contact in the reconnect queue. */
export async function setSnooze(
  owner: string,
  email: string,
  until: string | null
): Promise<{ available: boolean }> {
  const { error } = await getSupabaseAdmin()
    .from('contacts')
    .update({ snoozed_until: until, updated_at: new Date().toISOString() })
    .eq('owner_email', owner)
    .eq('email', email.toLowerCase());
  if (error) {
    if (isMissingStore(error) || isMissingColumn(error)) return { available: false };
    throw new Error(`Failed to snooze contact: ${error.message}`);
  }
  return { available: true };
}

/** Set/clear spam flags for a batch of emails. */
export async function setSpamFlags(
  owner: string,
  emails: string[],
  isSpam: boolean
): Promise<{ available: boolean }> {
  if (emails.length === 0) return { available: true };
  const { error } = await getSupabaseAdmin()
    .from('contacts')
    .update({ is_spam: isSpam, updated_at: new Date().toISOString() })
    .eq('owner_email', owner)
    .in('email', emails.map((e) => e.toLowerCase()));
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to update spam flags: ${error.message}`);
  }
  return { available: true };
}
