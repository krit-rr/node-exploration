import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore } from './contactsStore';
import { normalizeRosterEntries, type RosterEntry } from '@/utils/roster';

export interface RosterSummary {
  event: string;
  count: number;
  updatedAt: string;
}

export async function listRosters(owner: string): Promise<{ available: boolean; rosters: RosterSummary[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('rosters')
    .select('event, entries, updated_at')
    .eq('owner_email', owner)
    .order('updated_at', { ascending: false });
  if (error) {
    if (isMissingStore(error)) return { available: false, rosters: [] };
    throw new Error(`Failed to list rosters: ${error.message}`);
  }
  return {
    available: true,
    rosters: ((data ?? []) as { event: string; entries: unknown; updated_at: string }[]).map(row => ({
      event: row.event,
      count: Array.isArray(row.entries) ? row.entries.length : 0,
      updatedAt: row.updated_at,
    })),
  };
}

export async function getRoster(owner: string, event: string): Promise<{ available: boolean; entries: RosterEntry[] | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from('rosters')
    .select('entries')
    .eq('owner_email', owner)
    .eq('event', event)
    .maybeSingle();
  if (error) {
    if (isMissingStore(error)) return { available: false, entries: null };
    throw new Error(`Failed to read the roster: ${error.message}`);
  }
  const row = data as { entries: unknown } | null;
  return { available: true, entries: row ? normalizeRosterEntries(Array.isArray(row.entries) ? row.entries : []) : null };
}

export async function saveRoster(owner: string, event: string, entries: RosterEntry[]): Promise<{ available: boolean }> {
  const { error } = await getSupabaseAdmin()
    .from('rosters')
    .upsert({ owner_email: owner, event, entries, updated_at: new Date().toISOString() }, { onConflict: 'owner_email,event' });
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to save the roster: ${error.message}`);
  }
  return { available: true };
}

export async function deleteRoster(owner: string, event: string): Promise<{ available: boolean }> {
  const { error } = await getSupabaseAdmin().from('rosters').delete().eq('owner_email', owner).eq('event', event);
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to delete the roster: ${error.message}`);
  }
  return { available: true };
}
