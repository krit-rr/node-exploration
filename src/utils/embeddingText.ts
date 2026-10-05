import { createHash } from 'crypto';
import { Contact } from '@/types';

/**
 * The canonical text embedded for a contact. Field labels give the model
 * context; the hash of this exact string decides whether a re-sync needs a
 * new embedding, so any change to this format re-embeds every contact once.
 */
export function contactEmbeddingText(contact: Contact): string {
  const parts = [`Name: ${contact.name}`, `Email: ${contact.email}`];
  if (contact.company) parts.push(`Company: ${contact.company}`);
  if (contact.industry) parts.push(`Industry: ${contact.industry}`);
  if (contact.tags?.length) parts.push(`Tags: ${contact.tags.join(', ')}`);
  for (const field of contact.customFields ?? []) {
    if (field.label && field.value) parts.push(`${field.label}: ${field.value}`);
  }
  if (contact.notes) parts.push(`Notes: ${contact.notes}`);
  return parts.join('\n');
}

/**
 * Text embedded for a single interaction. Returns null when the interaction
 * carries no content worth embedding (date-only interactions).
 */
export function interactionEmbeddingText(
  interaction: { date: string; subject?: string; snippet?: string },
  contact: { name: string; email: string }
): string | null {
  const content = [
    interaction.subject && `Subject: ${interaction.subject}`,
    interaction.snippet,
  ]
    .filter(Boolean)
    .join('\n');
  if (!content) return null;
  return `Email to ${contact.name} <${contact.email}> on ${interaction.date}\n${content}`;
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
