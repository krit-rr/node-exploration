import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore } from './contactsStore';

export type StoredGroup = {
  id: string;
  name: string;
  members: string[];
};

type GroupRow = {
  id: string;
  name: string;
  members: unknown;
};

/** All groups for one owner. `available: false` until the migration runs. */
export async function listGroups(
  owner: string
): Promise<{ available: boolean; groups: StoredGroup[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('groups')
    .select('id, name, members')
    .eq('owner_email', owner)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingStore(error)) return { available: false, groups: [] };
    throw new Error(`Failed to list groups: ${error.message}`);
  }
  return {
    available: true,
    groups: (data as GroupRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      members: Array.isArray(row.members) ? (row.members as string[]) : [],
    })),
  };
}

/**
 * Replace-set the owner's groups: upsert everything sent, delete everything
 * absent. The client owns group ids, so this is idempotent and matches the
 * hook's "save the whole array" contract.
 */
export async function replaceGroups(
  owner: string,
  groups: StoredGroup[]
): Promise<{ available: boolean }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: readError } = await supabase
    .from('groups')
    .select('id')
    .eq('owner_email', owner);
  if (readError) {
    if (isMissingStore(readError)) return { available: false };
    throw new Error(`Failed to read groups: ${readError.message}`);
  }

  const keep = new Set(groups.map((g) => g.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('owner_email', owner)
      .in('id', toDelete);
    if (error) throw new Error(`Failed to delete groups: ${error.message}`);
  }

  if (groups.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('groups').upsert(
      groups.map((g) => ({
        owner_email: owner,
        id: g.id,
        name: g.name,
        members: g.members,
        updated_at: now,
      })),
      { onConflict: 'owner_email,id' }
    );
    if (error) {
      if (isMissingStore(error)) return { available: false };
      throw new Error(`Failed to upsert groups: ${error.message}`);
    }
  }
  return { available: true };
}
