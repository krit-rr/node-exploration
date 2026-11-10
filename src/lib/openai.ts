import OpenAI from 'openai';

/**
 * One OpenAI client per server instance, shared by every paid path
 * (embeddings, enrichment, memory), so a single place reads the key.
 */
let client: OpenAI | null = null;

/** True when a model key is configured; a route checks this before promising a model. */
export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Throws when no key is set so a paid path fails loudly instead of quietly doing nothing. */
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
