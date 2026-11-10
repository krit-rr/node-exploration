import { getSupabaseAdmin } from './supabaseAdmin';
import { isMissingStore, listContactsByEmail } from './contactsStore';
import { assessCadence } from '@/utils/reconnect';
import { asTieModel, GLOBAL_MODEL, learn, tieFeatures, type TieModel } from '@/utils/tieStrength';

export type LabelSource = 'touch' | 'snooze' | 'spam' | 'intent' | 'tag';

export async function getTieModel(owner: string): Promise<{ available: boolean; model: TieModel }> {
  const { data, error } = await getSupabaseAdmin()
    .from('tie_models')
    .select('weights, bias, labels')
    .eq('owner_email', owner)
    .maybeSingle();
  if (error) {
    if (isMissingStore(error)) return { available: false, model: GLOBAL_MODEL };
    throw new Error(`Failed to read the tie model: ${error.message}`);
  }
  return { available: true, model: data ? asTieModel(data) : GLOBAL_MODEL };
}

async function saveTieModel(owner: string, model: TieModel): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('tie_models')
    .upsert({ owner_email: owner, weights: model.weights, bias: model.bias, labels: model.labels, updated_at: new Date().toISOString() }, { onConflict: 'owner_email' });
  if (error && !isMissingStore(error)) throw new Error(`Failed to save the tie model: ${error.message}`);
}

/**
 * Record what the user just said about some relationships and learn from
 * it: one row per label with the features at that moment, one gradient
 * step per label on the user's model. Best effort: a missing table or a
 * failure here never fails the action that produced the label.
 */
export async function recordLabels(owner: string, emails: string[], label: 1 | -1, source: LabelSource): Promise<void> {
  const wanted = Array.from(new Set(emails.map(e => e.toLowerCase()))).slice(0, 50);
  if (wanted.length === 0) return;
  try {
    const stored = await listContactsByEmail(owner, wanted);
    if (!stored.available || stored.contacts.length === 0) return;
    const state = await getTieModel(owner);
    if (!state.available) return;
    const now = Date.now();
    const assessments = assessCadence(stored.contacts, undefined, now);
    let model = state.model;
    const rows = [];
    for (const contact of stored.contacts) {
      const assessment = assessments.get(contact.email.toLowerCase());
      if (!assessment) continue;
      const features = tieFeatures(contact, assessment, { now });
      rows.push({ owner_email: owner, contact_email: contact.email.toLowerCase(), label, source, features });
      model = learn(model, features, label);
    }
    if (rows.length === 0) return;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('relationship_labels').insert(rows);
    if (error) {
      if (isMissingStore(error)) return;
      throw new Error(`Failed to record labels: ${error.message}`);
    }
    await saveTieModel(owner, model);
  } catch (error) {
    console.error('Could not learn from the last action:', error);
  }
}
