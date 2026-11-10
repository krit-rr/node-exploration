import type { Contact } from '@/types';
import { circleKey, nameCircle } from '@/utils/circles';

/**
 * Semantic circles: the groups implied by alike profiles rather than by
 * shared emails. From each seed's nearest neighbours by embedding (computed
 * in Postgres, no model call) comes a graph; its connected components above
 * a similarity floor are circles. Beside the implicit circles from the mail,
 * these find the people who belong together without ever having been on one
 * message: the climate founders you met at three different events.
 */

export interface SimilarityEdge {
  a: string;
  b: string;
  /** Cosine similarity of the two profile embeddings, 0 to 1. */
  similarity: number;
}

export interface SemanticCircle {
  /** A hash of the sorted member list, for rendering; dismissals hang on the members. */
  key: string;
  /** The heuristic name (shared company, domain or event, else the people); the model may replace it. */
  name: string;
  /** Member emails, strongest ties first. */
  members: string[];
  /** Mean similarity of the edges inside the circle, 0 to 1. */
  cohesion: number;
}

/** Below this two profiles are not alike enough to put in one circle. */
export const MIN_SIMILARITY = 0.55;
export const MIN_MEMBERS = 3;
/** A circle bigger than this is a crowd; the best-connected members are kept. */
export const MAX_MEMBERS = 12;
/** Share of a circle already inside an existing group for it to be that group. */
const EXISTING_OVERLAP = 0.8;

function containedIn(part: Set<string>, whole: Set<string>): number {
  let shared = 0;
  for (const m of part) if (whole.has(m)) shared++;
  return part.size === 0 ? 0 : shared / part.size;
}

export function semanticCircles(
  edges: SimilarityEdge[],
  contacts: Contact[],
  existingGroups: { members: string[] }[] = [],
  { limit = 4 }: { limit?: number } = {}
): SemanticCircle[] {
  const byEmail = new Map<string, Contact>();
  for (const contact of contacts) {
    if (!contact.isSpam) byEmail.set(contact.email.toLowerCase(), contact);
  }

  // Union-find over edges above the floor, between people on the list.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const strength = new Map<string, number>();
  const kept: SimilarityEdge[] = [];
  for (const edge of edges) {
    const a = edge.a.toLowerCase();
    const b = edge.b.toLowerCase();
    if (a === b || edge.similarity < MIN_SIMILARITY || !byEmail.has(a) || !byEmail.has(b)) continue;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    kept.push({ a, b, similarity: edge.similarity });
    strength.set(a, (strength.get(a) ?? 0) + edge.similarity);
    strength.set(b, (strength.get(b) ?? 0) + edge.similarity);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const components = new Map<string, Set<string>>();
  for (const email of parent.keys()) {
    const root = find(email);
    const set = components.get(root) ?? new Set<string>();
    set.add(email);
    components.set(root, set);
  }

  const existing = existingGroups.map(g => new Set(g.members.map(m => m.toLowerCase())));
  const circles: SemanticCircle[] = [];
  for (const set of components.values()) {
    // A crowd is cut to its best-connected members.
    const members = Array.from(set)
      .sort((x, y) => (strength.get(y) ?? 0) - (strength.get(x) ?? 0) || x.localeCompare(y))
      .slice(0, MAX_MEMBERS);
    if (members.length < MIN_MEMBERS) continue;
    const inside = new Set(members);
    if (existing.some(g => containedIn(inside, g) >= EXISTING_OVERLAP)) continue;
    const insideEdges = kept.filter(e => inside.has(e.a) && inside.has(e.b));
    const cohesion = insideEdges.length ? insideEdges.reduce((sum, e) => sum + e.similarity, 0) / insideEdges.length : 0;
    circles.push({
      key: circleKey([...members].sort()),
      name: nameCircle(members, byEmail),
      members,
      cohesion,
    });
  }
  return circles.sort((a, b) => b.cohesion * b.members.length - a.cohesion * a.members.length || a.name.localeCompare(b.name)).slice(0, limit);
}
