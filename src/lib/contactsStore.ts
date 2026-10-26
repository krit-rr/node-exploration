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
  introduced_by: string | null;
  alt_emails?: unknown;
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

// The reconnect migration adds met_at / snoozed_until, Phase B adds
// introduced_by, and the duplicate-merge migration adds alt_emails. Until a
// database has them, PostgREST rejects statements naming those columns
// (PGRST204 / 42703); strip them and retry so core persistence keeps
// working pre-migration.
const NEW_COLUMNS = ['met_at', 'snoozed_until', 'introduced_by', 'alt_emails'] as const;

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

const latestIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
};

type Interaction = NonNullable<Contact['interactions']>[number];

// Same cap logTouch uses; a merged history must not grow a row unboundedly.
const MAX_INTERACTIONS = 50;

/** Dedupe, sort newest-first, and cap a combined interaction history. */
function combineInteractions(interactions: Interaction[]): Interaction[] {
  const seen = new Set<string>();
  const combined: Interaction[] = [];
  for (const interaction of interactions) {
    if (!interaction?.date) continue;
    const key = `${interaction.date}|${interaction.type}|${interaction.channel ?? ''}|${interaction.subject ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(interaction);
  }
  combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return combined.slice(0, MAX_INTERACTIONS);
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
    introducedBy: row.introduced_by ?? undefined,
    ...(asArray(row.alt_emails).length > 0
      ? { altEmails: asArray(row.alt_emails).map(String) }
      : {}),
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

  type SyncReadRow = Pick<
    ContactRow,
    'email' | 'name' | 'company' | 'industry' | 'last_contacted' | 'is_spam' | 'notes'
  > & { interactions?: unknown; alt_emails?: unknown };
  const firstRead = await supabase
    .from('contacts')
    .select('email, name, company, industry, last_contacted, is_spam, notes, interactions, alt_emails')
    .eq('owner_email', owner);
  let existingRows = firstRead.data as SyncReadRow[] | null;
  let readError = firstRead.error;
  if (readError && isMissingColumn(readError)) {
    // Pre-merge-migration: no alt_emails column means no merged addresses.
    const retry = await supabase
      .from('contacts')
      .select('email, name, company, industry, last_contacted, is_spam, notes, interactions')
      .eq('owner_email', owner);
    existingRows = retry.data as SyncReadRow[] | null;
    readError = retry.error;
  }
  if (readError) {
    if (isMissingStore(readError)) return { available: false };
    throw new Error(`Failed to read contacts for merge: ${readError.message}`);
  }
  const existing = new Map((existingRows ?? []).map((r) => [r.email, r]));

  // Addresses folded into another contact by a duplicate merge: activity on
  // them belongs to the surviving row, never a resurrected duplicate.
  const altOwner = new Map<string, string>();
  for (const row of existing.values()) {
    for (const alt of asArray(row.alt_emails)) altOwner.set(String(alt).toLowerCase(), row.email);
  }

  const byTarget = new Map<string, Contact[]>();
  for (const contact of incoming) {
    const email = contact.email.toLowerCase();
    const target = altOwner.get(email) ?? email;
    const group = byTarget.get(target);
    if (group) group.push(contact);
    else byTarget.set(target, [contact]);
  }

  const now = new Date().toISOString();
  const rows = Array.from(byTarget.entries()).map(([email, group]) => {
    const prior = existing.get(email);
    const direct = group.find((c) => c.email.toLowerCase() === email) ?? group[0];
    const redirected = group.some((c) => c.email.toLowerCase() !== email);
    // A merged row's history spans addresses the provider reports separately
    // (or no longer reports at all), so combine instead of the usual
    // provider-wins replacement; plain rows keep the replacement semantics.
    const spansAddresses = redirected || asArray(prior?.alt_emails).length > 0;
    const incomingLatest = group.reduce<string | null>(
      (latest, c) => latestIso(latest, c.lastContacted || null),
      null
    );
    return {
      owner_email: owner,
      email,
      // A stored name is a user-visible identity the user may have edited;
      // only fill it from the provider when we have nothing.
      name: prior?.name || direct.name || email,
      company: direct.company ?? prior?.company ?? null,
      industry: direct.industry ?? prior?.industry ?? null,
      last_contacted: spansAddresses
        ? latestIso(incomingLatest, prior?.last_contacted ?? null)
        : direct.lastContacted || prior?.last_contacted || null,
      interactions: spansAddresses
        ? combineInteractions([
            ...group.flatMap((c) => c.interactions ?? []),
            ...(asArray(prior?.interactions) as Interaction[]),
          ])
        : direct.interactions ?? [],
      source: provider,
      enriched_by: direct.enrichedBy ?? null,
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
  let rows = incoming.map((contact) => ({
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
    introduced_by: contact.introducedBy ?? null,
    source: (contact as Contact & { source?: string }).source ?? 'csv_import',
    enriched_by: contact.enrichedBy ?? null,
    updated_at: now,
  }));

  // Route rows addressed to a merged-away duplicate to the surviving
  // contact, so a re-import can't resurrect a deleted duplicate row.
  const altOwner = new Map<string, string>();
  {
    const { data: altRows, error: altError } = await getSupabaseAdmin()
      .from('contacts')
      .select('email, alt_emails')
      .eq('owner_email', owner);
    if (altError) {
      if (isMissingStore(altError)) return { available: false };
      // Pre-merge-migration (no alt_emails column): nothing was ever merged.
      if (!isMissingColumn(altError)) {
        throw new Error(`Failed to read merged addresses: ${altError.message}`);
      }
    } else {
      for (const r of (altRows ?? []) as { email: string; alt_emails?: unknown }[]) {
        for (const alt of asArray(r.alt_emails)) altOwner.set(String(alt).toLowerCase(), r.email);
      }
    }
  }
  const redirectedEmails = new Set<string>();
  if (altOwner.size > 0) {
    const byTarget = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const target = altOwner.get(row.email) ?? row.email;
      if (target !== row.email) redirectedEmails.add(target);
      const prior = byTarget.get(target);
      if (!prior) {
        byTarget.set(target, { ...row, email: target });
      } else {
        // Two import rows landed on one contact (the primary address plus a
        // merged one): collapse them so the upsert touches the row once.
        byTarget.set(target, {
          ...prior,
          company: prior.company || row.company,
          industry: prior.industry || row.industry,
          last_contacted: latestIso(prior.last_contacted, row.last_contacted),
          tags: prior.tags.length > 0 ? prior.tags : row.tags,
          notes: prior.notes || row.notes,
          met_at: prior.met_at ?? row.met_at,
          introduced_by: prior.introduced_by ?? row.introduced_by,
        });
      }
    }
    rows = Array.from(byTarget.values());
  }

  // Re-importing someone (common once event lists are imported twice) must
  // not wipe the context already on their row: a bare CSV row carries no
  // tags, notes, met-at or intro, and a blind upsert would blank them all.
  // Incoming values still win when present (an event stamp is deliberate).
  type PrevRow = {
    email: string;
    name?: string | null;
    company: string | null;
    industry: string | null;
    last_contacted: string | null;
    tags: string[] | null;
    notes: string | null;
    met_at?: string | null;
    introduced_by?: string | null;
  };
  const { data, error: existingError } = await getSupabaseAdmin()
    .from('contacts')
    .select('email, name, company, industry, last_contacted, tags, notes, met_at, introduced_by')
    .eq('owner_email', owner)
    .in('email', rows.map((r) => r.email));
  let existingRows = (data as PrevRow[] | null) ?? null;
  if (!existingRows && isMissingColumn(existingError)) {
    const retry = await getSupabaseAdmin()
      .from('contacts')
      .select('email, name, company, industry, last_contacted, tags, notes')
      .eq('owner_email', owner)
      .in('email', rows.map((r) => r.email));
    existingRows = (retry.data as PrevRow[] | null) ?? null;
  }
  if (existingRows) {
    const byEmail = new Map(existingRows.map((r) => [r.email, r]));
    rows = rows.map((row) => {
      const prev = byEmail.get(row.email);
      if (!prev) return row;
      return {
        ...row,
        // A redirected row carries the duplicate address's CSV name; the
        // surviving contact's stored name is the identity the user kept.
        name: redirectedEmails.has(row.email) && prev.name ? prev.name : row.name,
        company: row.company || prev.company || null,
        industry: row.industry || prev.industry || null,
        last_contacted: latestIso(row.last_contacted, prev.last_contacted),
        tags: row.tags.length > 0 ? row.tags : prev.tags ?? [],
        notes: row.notes || prev.notes || '',
        met_at: row.met_at ?? prev.met_at ?? null,
        introduced_by: row.introduced_by ?? prev.introduced_by ?? null,
      };
    });
  }

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
    introduced_by: updated.introducedBy ?? null,
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

/**
 * Merge two contacts that are the same person under two addresses. The
 * duplicate's context (tags, notes, history, custom fields, met-at, intro)
 * folds into the primary row, the duplicate's address is remembered in
 * alt_emails so syncs and imports keep routing to the survivor, and the
 * duplicate row and its embeddings are removed. Without the duplicate-merge
 * migration the merge would silently undo itself on the next provider sync,
 * so it reports unavailable instead of merging lossily.
 */
export async function mergeContacts(
  owner: string,
  primaryEmail: string,
  duplicateEmail: string
): Promise<{ available: boolean; contact: Contact | null }> {
  const supabase = getSupabaseAdmin();
  const primary = primaryEmail.toLowerCase();
  const duplicate = duplicateEmail.toLowerCase();

  const { data: rows, error: readError } = await supabase
    .from('contacts')
    .select('*')
    .eq('owner_email', owner)
    .in('email', [primary, duplicate]);
  if (readError) {
    if (isMissingStore(readError)) return { available: false, contact: null };
    throw new Error(`Failed to read contacts for merge: ${readError.message}`);
  }
  const primaryRow = (rows as ContactRow[]).find((r) => r.email === primary);
  const duplicateRow = (rows as ContactRow[]).find((r) => r.email === duplicate);
  if (!primaryRow || !duplicateRow) return { available: true, contact: null };

  const tags = Array.from(
    new Set([...asArray(primaryRow.tags), ...asArray(duplicateRow.tags)].map(String))
  );
  type StoredField = { id?: string; label?: string; value?: string };
  const primaryFields = asArray(primaryRow.custom_fields) as StoredField[];
  const knownLabels = new Set(primaryFields.map((f) => (f.label ?? '').toLowerCase()));
  const customFields = [
    ...primaryFields,
    ...(asArray(duplicateRow.custom_fields) as StoredField[]).filter(
      (f) => f.label && !knownLabels.has(f.label.toLowerCase())
    ),
  ];
  const notes = [primaryRow.notes, duplicateRow.notes]
    .map((n) => (n ?? '').trim())
    .filter((n, index, all) => n && all.indexOf(n) === index)
    .join('\n\n');
  const altEmails = Array.from(
    new Set([
      ...asArray(primaryRow.alt_emails).map(String),
      ...asArray(duplicateRow.alt_emails).map(String),
      duplicate,
    ])
  ).filter((e) => e !== primary);

  const patch = {
    company: primaryRow.company ?? duplicateRow.company,
    industry: primaryRow.industry ?? duplicateRow.industry,
    last_contacted: latestIso(primaryRow.last_contacted, duplicateRow.last_contacted),
    interactions: combineInteractions([
      ...(asArray(primaryRow.interactions) as Interaction[]),
      ...(asArray(duplicateRow.interactions) as Interaction[]),
    ]),
    custom_fields: customFields,
    tags,
    notes,
    met_at: primaryRow.met_at ?? duplicateRow.met_at,
    introduced_by: primaryRow.introduced_by ?? duplicateRow.introduced_by,
    alt_emails: altEmails,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from('contacts')
    .update(patch)
    .eq('owner_email', owner)
    .eq('email', primary)
    .select('*');
  if (updateError) {
    if (isMissingStore(updateError) || isMissingColumn(updateError)) {
      return { available: false, contact: null };
    }
    throw new Error(`Failed to merge contacts: ${updateError.message}`);
  }

  const { error: deleteError } = await supabase
    .from('contacts')
    .delete()
    .eq('owner_email', owner)
    .eq('email', duplicate);
  if (deleteError) {
    // The primary already carries the merged context plus alt_emails, so a
    // retry of the same merge cleans this up; surface the failure.
    throw new Error(`Failed to remove merged duplicate: ${deleteError.message}`);
  }

  // Best effort: keep semantic search from surfacing the deleted row.
  // supabase-js reports errors in the result, so these never throw.
  await supabase
    .from('contact_embeddings')
    .delete()
    .eq('owner_email', owner)
    .eq('contact_email', duplicate);
  await supabase
    .from('interaction_embeddings')
    .delete()
    .eq('owner_email', owner)
    .eq('contact_email', duplicate);

  return { available: true, contact: rowToContact(updated![0] as ContactRow) };
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

/**
 * Log a touch: a call, meeting, or email the user initiated. Appends a
 * dated interaction and bumps last_contacted so recency is honest for
 * networking that happens off-email.
 */
export async function logTouch(
  owner: string,
  email: string,
  channel: 'email' | 'call' | 'meeting' | 'other',
  note?: string
): Promise<{ available: boolean; contact: Contact | null }> {
  const supabase = getSupabaseAdmin();
  const target = email.toLowerCase();

  const { data: rows, error: readError } = await supabase
    .from('contacts')
    .select('*')
    .eq('owner_email', owner)
    .eq('email', target);
  if (readError) {
    if (isMissingStore(readError)) return { available: false, contact: null };
    throw new Error(`Failed to read contact for touch: ${readError.message}`);
  }
  if (!rows || rows.length === 0) return { available: true, contact: null };

  const row = rows[0] as ContactRow;
  const now = new Date().toISOString();
  const interaction = {
    date: now,
    channel,
    type: 'sent' as const,
    ...(note ? { subject: note.slice(0, 200) } : {}),
  };
  const interactions = [interaction, ...asArray(row.interactions)].slice(0, 50);

  const { data, error } = await supabase
    .from('contacts')
    .update({ interactions, last_contacted: now, updated_at: now })
    .eq('owner_email', owner)
    .eq('email', target)
    .select('*');
  if (error) {
    if (isMissingStore(error)) return { available: false, contact: null };
    throw new Error(`Failed to log touch: ${error.message}`);
  }
  return { available: true, contact: rowToContact(data![0] as ContactRow) };
}

/** Add one tag to many contacts (bulk tagging from the table). */
export async function bulkAddTag(
  owner: string,
  emails: string[],
  tag: string
): Promise<{ available: boolean; updated: number }> {
  const supabase = getSupabaseAdmin();
  const targets = emails.map((e) => e.toLowerCase());

  const { data: rows, error: readError } = await supabase
    .from('contacts')
    .select('email, tags')
    .eq('owner_email', owner)
    .in('email', targets);
  if (readError) {
    if (isMissingStore(readError)) return { available: false, updated: 0 };
    throw new Error(`Failed to read contacts for tagging: ${readError.message}`);
  }

  const now = new Date().toISOString();
  const updates = (rows as { email: string; tags: unknown }[])
    .filter((row) => !asArray(row.tags).includes(tag))
    .map((row) => ({
      owner_email: owner,
      email: row.email,
      tags: [...asArray(row.tags), tag],
      updated_at: now,
    }));
  if (updates.length === 0) return { available: true, updated: 0 };

  // Per-row updates: an upsert would need every not-null column restated.
  for (const update of updates) {
    const { error } = await supabase
      .from('contacts')
      .update({ tags: update.tags, updated_at: update.updated_at })
      .eq('owner_email', owner)
      .eq('email', update.email);
    if (error) {
      if (isMissingStore(error)) return { available: false, updated: 0 };
      throw new Error(`Failed to tag contact: ${error.message}`);
    }
  }
  return { available: true, updated: updates.length };
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
