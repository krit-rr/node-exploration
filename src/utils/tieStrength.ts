import type { Contact } from '@/types';
import type { CadenceAssessment } from '@/utils/reconnect';
import { PRIORITY_TAG } from '@/utils/reconnect';

/**
 * Tie strength that learns. Gilbert and Karahalios separated strong from
 * weak ties with the signals Node already stores (days since last and
 * first contact above all, then volume, reciprocity, intimacy words and
 * structure); Gmail's Priority Inbox learned from what people did rather
 * than from labels they typed. Here both: a small logistic model over those
 * features, with a global prior and per-user weights that take one
 * gradient step for every action that says who matters (a logged touch, a
 * key-contact tag, an inner-ring intent) or does not (a snooze, a spam
 * flag). It replaces the closeness heuristic gradually, as the labels come.
 */

export const TIE_FEATURES = ['recency', 'tenure', 'volume', 'reciprocity', 'intimacy', 'structure', 'marked'] as const;
export type FeatureName = (typeof TIE_FEATURES)[number];
export type TieFeatures = Record<FeatureName, number>;

export interface TieModel {
  weights: Record<FeatureName, number>;
  bias: number;
  /** How many labels this user's model has learned from. */
  labels: number;
}

/** The global prior: the shape of the published results, before any user action. */
export const GLOBAL_MODEL: TieModel = {
  weights: { recency: 2.4, tenure: 0.8, volume: 1.2, reciprocity: 0.9, intimacy: 0.8, structure: 0.5, marked: 1.6 },
  bias: -2.6,
  labels: 0,
};
/** Below this many labels the model is not trusted at all; at this many, fully. */
export const MIN_LABELS = 20;
export const FULL_LABELS = 100;
export const LEARNING_RATE = 0.15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Words that mark a personal rather than transactional thread, counted in subjects, previews and notes. */
const INTIMACY = /\b(thanks|thank you|love|family|dinner|lunch|coffee|drinks|birthday|congrats|congratulations|miss you|hope you|wedding|baby|weekend|holiday|kids|catch up|cheers|hug)\b/gi;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The relationship as the model sees it, every feature roughly 0 to 1. */
export function tieFeatures(
  contact: Contact,
  assessment: CadenceAssessment,
  { now = Date.now(), priorityEmails }: { now?: number; priorityEmails?: Set<string> } = {}
): TieFeatures {
  const interactions = contact.interactions ?? [];
  const times = interactions.map(i => new Date(i.date).getTime()).filter(t => !Number.isNaN(t));
  const created = contact.createdAt ? new Date(contact.createdAt).getTime() : NaN;
  if (!Number.isNaN(created)) times.push(created);
  const first = times.length ? Math.min(...times) : now;
  const tenureDays = Math.max(0, (now - first) / DAY_MS);
  const received = interactions.filter(i => i.type === 'received').length;
  const text = [...interactions.map(i => `${i.subject ?? ''} ${i.snippet ?? ''}`), contact.notes ?? ''].join(' ');
  const intimacyHits = (text.match(INTIMACY) ?? []).length;
  const coRecipients = new Set(interactions.flatMap(i => (i.participants ?? []).map(p => p.toLowerCase()))).size;
  const marked =
    (contact.tags ?? []).some(t => t.toLowerCase() === PRIORITY_TAG) ||
    Boolean(priorityEmails?.has(contact.email.toLowerCase())) ||
    contact.intendedLayer === 1 ||
    contact.intendedLayer === 2;
  return {
    recency: assessment.neverTouched ? 0 : Math.exp(-Math.max(0, assessment.daysSince) / 90),
    tenure: clamp01(Math.log1p(tenureDays) / Math.log1p(730)),
    volume: clamp01(Math.log1p(assessment.touchesLastYear) / Math.log1p(24)),
    reciprocity: interactions.length ? received / interactions.length : 0,
    intimacy: clamp01(intimacyHits / 5),
    structure: clamp01(coRecipients / 10 + (contact.introducedBy?.trim() ? 0.3 : 0)),
    marked: marked ? 1 : 0,
  };
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** The model's probability that this is a strong tie, 0 to 1. */
export function tieStrength(features: TieFeatures, model: TieModel = GLOBAL_MODEL): number {
  let z = model.bias;
  for (const name of TIE_FEATURES) z += (model.weights[name] ?? 0) * (features[name] ?? 0);
  return sigmoid(z);
}

/** One gradient step on the logistic loss: a positive label pulls the probability up, a negative one down. */
export function learn(model: TieModel, features: TieFeatures, label: 1 | -1, rate = LEARNING_RATE): TieModel {
  const target = label === 1 ? 1 : 0;
  const error = tieStrength(features, model) - target;
  const weights = { ...model.weights };
  for (const name of TIE_FEATURES) weights[name] = (weights[name] ?? 0) - rate * error * (features[name] ?? 0);
  return { weights, bias: model.bias - rate * error, labels: model.labels + 1 };
}

/** How much of closeness the model decides: nothing below twenty labels, everything from a hundred. */
export function modelShare(labels: number): number {
  if (labels < MIN_LABELS) return 0;
  return clamp01((labels - MIN_LABELS) / (FULL_LABELS - MIN_LABELS));
}

/** The heuristic and the model, mixed by how much the model has learned. */
export function blendCloseness(heuristic: number, strength: number, labels: number): number {
  const share = modelShare(labels);
  return clamp01(heuristic * (1 - share) + strength * share);
}

/** A stored model, or the global prior when the row is missing or malformed. */
export function asTieModel(value: unknown): TieModel {
  if (!value || typeof value !== 'object') return GLOBAL_MODEL;
  const raw = value as { weights?: unknown; bias?: unknown; labels?: unknown };
  const weights = { ...GLOBAL_MODEL.weights };
  const stored = (raw.weights && typeof raw.weights === 'object' ? raw.weights : {}) as Record<string, unknown>;
  for (const name of TIE_FEATURES) {
    const w = stored[name];
    if (typeof w === 'number' && Number.isFinite(w)) weights[name] = w;
  }
  return {
    weights,
    bias: typeof raw.bias === 'number' && Number.isFinite(raw.bias) ? raw.bias : GLOBAL_MODEL.bias,
    labels: typeof raw.labels === 'number' && Number.isInteger(raw.labels) && raw.labels >= 0 ? raw.labels : 0,
  };
}
