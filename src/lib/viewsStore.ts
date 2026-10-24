import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore } from './contactsStore';

export type SavedViewConfig = {
  search?: string;
  filter?: string;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
};

export type SavedView = {
  id: string;
  name: string;
  config: SavedViewConfig;
};

/** All saved views for one owner. `available: false` until the migration runs. */
export async function listViews(
  owner: string
): Promise<{ available: boolean; views: SavedView[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('views')
    .select('id, name, config')
    .eq('owner_email', owner)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingStore(error)) return { available: false, views: [] };
    throw new Error(`Failed to list views: ${error.message}`);
  }
  return {
    available: true,
    views: (data as SavedView[]).map((row) => ({
      id: row.id,
      name: row.name,
      config: (row.config ?? {}) as SavedViewConfig,
    })),
  };
}

/** Replace-set the owner's saved views, same contract as groups. */
export async function replaceViews(
  owner: string,
  views: SavedView[]
): Promise<{ available: boolean }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: readError } = await supabase
    .from('views')
    .select('id')
    .eq('owner_email', owner);
  if (readError) {
    if (isMissingStore(readError)) return { available: false };
    throw new Error(`Failed to read views: ${readError.message}`);
  }

  const keep = new Set(views.map((v) => v.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('views')
      .delete()
      .eq('owner_email', owner)
      .in('id', toDelete);
    if (error) throw new Error(`Failed to delete views: ${error.message}`);
  }

  if (views.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('views').upsert(
      views.map((v) => ({
        owner_email: owner,
        id: v.id,
        name: v.name,
        config: v.config,
        updated_at: now,
      })),
      { onConflict: 'owner_email,id' }
    );
    if (error) {
      if (isMissingStore(error)) return { available: false };
      throw new Error(`Failed to upsert views: ${error.message}`);
    }
  }
  return { available: true };
}
