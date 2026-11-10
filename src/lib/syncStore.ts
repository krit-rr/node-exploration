import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore } from './contactsStore';

/** How far back one mailbox has been read. */
export interface SyncCursor {
  /** ISO time of the oldest message read so far; null before any page was read. */
  beforeTime: string | null;
  pages: number;
  messages: number;
  done: boolean;
}

type CursorRow = { before_time: string | null; pages: number; messages: number; done: boolean };

const EMPTY: SyncCursor = { beforeTime: null, pages: 0, messages: 0, done: false };

export async function getSyncCursor(
  owner: string,
  provider: string
): Promise<{ available: boolean; cursor: SyncCursor | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from('sync_cursors')
    .select('before_time, pages, messages, done')
    .eq('owner_email', owner)
    .eq('provider', provider)
    .maybeSingle();
  if (error) {
    if (isMissingStore(error)) return { available: false, cursor: null };
    throw new Error(`Failed to read the sync cursor: ${error.message}`);
  }
  const row = data as CursorRow | null;
  return {
    available: true,
    cursor: row
      ? { beforeTime: row.before_time, pages: row.pages ?? 0, messages: row.messages ?? 0, done: Boolean(row.done) }
      : null,
  };
}

export async function saveSyncCursor(owner: string, provider: string, cursor: SyncCursor): Promise<{ available: boolean }> {
  const { error } = await getSupabaseAdmin()
    .from('sync_cursors')
    .upsert(
      {
        owner_email: owner,
        provider,
        before_time: cursor.beforeTime,
        pages: cursor.pages,
        messages: cursor.messages,
        done: cursor.done,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_email,provider' }
    );
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to save the sync cursor: ${error.message}`);
  }
  return { available: true };
}

/** After the first sync: remember where its page ended, so the backfill starts from there instead of re-reading it. */
export async function seedSyncCursor(owner: string, provider: string, oldestTime: number | null, messages: number): Promise<void> {
  if (oldestTime === null) return;
  const existing = await getSyncCursor(owner, provider);
  if (!existing.available || existing.cursor) return;
  await saveSyncCursor(owner, provider, { ...EMPTY, beforeTime: new Date(oldestTime).toISOString(), messages });
}

export { EMPTY as EMPTY_SYNC_CURSOR };
