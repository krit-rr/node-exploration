import type { Contact } from '@/types';
import { assessCadence, cadenceStatus, type CadenceAssessment } from '@/utils/reconnect';
import { computeOrbit, type OrbitLayer } from '@/utils/orbit';
import type { TieModel } from '@/utils/tieStrength';
import { lastSubject } from '@/utils/interactions';
import { cleanLine } from '@/utils/draft';

/**
 * Ask your network: a question over the embeddings Node already keeps.
 * Contacts and past emails that match the question are gathered, each with
 * the facts on record, and ranked by how alike they are to the question
 * nudged toward the middle rings, because the people most able to help are
 * usually moderately weak ties (Rajkumar et al.) rather than the inner five,
 * who the user would think of unaided. The model, when there is one, writes
 * a short answer from those facts alone; without one the ranked people and
 * their facts are the answer.
 */

export interface AskHit {
  email: string;
  similarity: number;
  /** A matching past email, when the hit came from the interaction index. */
  interaction?: { date: string; content: string };
}

export interface AskPerson {
  email: string;
  name: string;
  company?: string;
  industry?: string;
  layer: OrbitLayer;
  /** Where this relationship stands, in the rail's words. */
  status: string;
  /** The one line of context that makes the ask specific: an open loop, a matching email, or the last subject. */
  context?: string;
  score: number;
  /** Everything the model may say about this person, one fact per line. */
  facts: string[];
}

/** Similarity is nudged by ring: the 15 and 50 rings first, the inner five and the outer band less. */
export const RING_WEIGHT: Record<OrbitLayer, number> = { 1: 0.85, 2: 1.1, 3: 1.05, 4: 0.9, 5: 0.6 };
export const MAX_PEOPLE = 6;
const MAX_FACT = 160;

function openLoopLine(contact: Contact): string | undefined {
  const loop = contact.memory?.openLoops[0];
  if (!loop) return undefined;
  return `${loop.who === 'you' ? 'You promised to' : 'They promised to'} ${loop.text} (${loop.date})`;
}

function interactionLine(hit: AskHit): string | undefined {
  if (!hit.interaction) return undefined;
  // The indexed text starts with an "Email to ... on ..." header; the subject and snippet follow.
  const body = hit.interaction.content.split('\n').slice(1).join(' ').replace(/^Subject:\s*/i, '');
  const day = String(hit.interaction.date).slice(0, 10);
  return body ? `Email on ${day}: ${cleanLine(body, 120)}` : undefined;
}

/** Facts about one person, as data for the model and as the card's lines. */
export function personFacts(contact: Contact, assessment: CadenceAssessment, hit?: AskHit): string[] {
  const facts = [`Name: ${cleanLine(contact.name || contact.email, 80)}`];
  if (contact.company) facts.push(`Company: ${cleanLine(contact.company, 80)}`);
  if (contact.industry) facts.push(`Industry: ${cleanLine(contact.industry, 80)}`);
  if (contact.metAt) facts.push(`Met at: ${cleanLine(contact.metAt, 100)}`);
  if (contact.introducedBy) facts.push(`Introduced by: ${cleanLine(contact.introducedBy, 80)}`);
  if (contact.tags?.length) facts.push(`Tags: ${cleanLine(contact.tags.join(', '), 120)}`);
  if (contact.notes?.trim()) facts.push(`Your notes: ${cleanLine(contact.notes, MAX_FACT)}`);
  if (contact.memory?.summary) facts.push(`From your emails: ${cleanLine(contact.memory.summary, MAX_FACT)}`);
  const loop = openLoopLine(contact);
  if (loop) facts.push(`Open loop: ${cleanLine(loop, MAX_FACT)}`);
  const matched = hit ? interactionLine(hit) : undefined;
  if (matched) facts.push(matched);
  const subject = lastSubject(contact);
  if (subject && !matched) facts.push(`Last subject you sent: ${cleanLine(subject, 100)}`);
  facts.push(`Relationship: ${cadenceStatus(assessment)}`);
  return facts;
}

/**
 * Merge contact and interaction hits per person, attach the facts, and rank.
 * A person named by several past emails counts once, with the best match.
 */
export function rankPeople(
  hits: AskHit[],
  contacts: Contact[],
  { priorityEmails, now = Date.now(), limit = MAX_PEOPLE, model }: { priorityEmails?: Set<string>; now?: number; limit?: number; model?: TieModel } = {}
): AskPerson[] {
  const byEmail = new Map(contacts.map(c => [c.email.toLowerCase(), c]));
  const best = new Map<string, AskHit>();
  for (const hit of hits) {
    const email = hit.email.toLowerCase();
    const current = best.get(email);
    if (!current || hit.similarity > current.similarity) best.set(email, { ...hit, email });
  }
  if (best.size === 0) return [];
  const assessments = assessCadence(contacts, undefined, now);
  const layers = new Map(computeOrbit(contacts, { priorityEmails, now, model }).points.map(p => [p.email, p.layer]));

  const people: AskPerson[] = [];
  for (const [email, hit] of best) {
    const contact = byEmail.get(email);
    const assessment = assessments.get(email);
    if (!contact || !assessment || contact.isSpam) continue;
    const layer = layers.get(email) ?? 5;
    const context = openLoopLine(contact) ?? interactionLine(hit) ?? (lastSubject(contact) ? `Last subject: ${lastSubject(contact)}` : undefined);
    people.push({
      email,
      name: contact.name || contact.email,
      company: contact.company?.trim() || undefined,
      industry: contact.industry?.trim() || undefined,
      layer,
      status: cadenceStatus(assessment),
      context: context ? cleanLine(context, MAX_FACT) : undefined,
      score: hit.similarity * RING_WEIGHT[layer],
      facts: personFacts(contact, assessment, hit),
    });
  }
  return people.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface AskAnswer {
  /** A short answer in plain prose, empty when no model is configured. */
  answer: string;
  /** Who to go to, with one line each on why, in the model's order (or the ranking's, without a model). */
  people: { email: string; why: string }[];
}

/** Keep only people the facts named, clip everything, drop an empty answer. */
export function normalizeAnswer(raw: unknown, people: AskPerson[]): AskAnswer {
  const known = new Map(people.map(p => [p.email, p]));
  const data = (raw && typeof raw === 'object' ? raw : {}) as { answer?: unknown; people?: unknown };
  const answer = typeof data.answer === 'string' ? cleanLine(data.answer, 700) : '';
  const named: AskAnswer['people'] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(data.people) ? data.people : []) {
    const entry = (item && typeof item === 'object' ? item : {}) as { email?: unknown; why?: unknown };
    const email = typeof entry.email === 'string' ? entry.email.toLowerCase() : '';
    if (!known.has(email) || seen.has(email)) continue;
    seen.add(email);
    named.push({ email, why: typeof entry.why === 'string' ? cleanLine(entry.why, MAX_FACT) : '' });
  }
  return { answer, people: named };
}
