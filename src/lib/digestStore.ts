import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore } from './contactsStore';

/** Whether this owner asked for the Monday digest. `available: false` until the migration runs. */
export async function getDigestSubscription(
  owner: string
): Promise<{ available: boolean; enabled: boolean }> {
  const { data, error } = await getSupabaseAdmin()
    .from('digest_subscribers')
    .select('enabled')
    .eq('owner_email', owner)
    .maybeSingle();
  if (error) {
    if (isMissingStore(error)) return { available: false, enabled: false };
    throw new Error(`Failed to read digest subscription: ${error.message}`);
  }
  return { available: true, enabled: Boolean((data as { enabled?: boolean } | null)?.enabled) };
}

export async function setDigestSubscription(
  owner: string,
  enabled: boolean
): Promise<{ available: boolean }> {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from('digest_subscribers')
    .upsert({ owner_email: owner, enabled, updated_at: now }, { onConflict: 'owner_email' });
  if (error) {
    if (isMissingStore(error)) return { available: false };
    throw new Error(`Failed to save digest subscription: ${error.message}`);
  }
  return { available: true };
}

/** Everyone who opted in; the send route mails exactly these. */
export async function listDigestSubscribers(): Promise<{ available: boolean; owners: string[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from('digest_subscribers')
    .select('owner_email')
    .eq('enabled', true);
  if (error) {
    if (isMissingStore(error)) return { available: false, owners: [] };
    throw new Error(`Failed to list digest subscribers: ${error.message}`);
  }
  return { available: true, owners: ((data ?? []) as { owner_email: string }[]).map((r) => r.owner_email) };
}

export async function markDigestSent(owner: string): Promise<void> {
  const now = new Date().toISOString();
  await getSupabaseAdmin()
    .from('digest_subscribers')
    .update({ last_sent_at: now, updated_at: now })
    .eq('owner_email', owner);
}
