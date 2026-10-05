import OpenAI from 'openai';

/**
 * Must match the vector(1536) column size in supabase/migrations.
 * OPENAI_EMBED_MODEL must be a text-embedding-3 model (they accept the
 * `dimensions` parameter); changing dimensions requires a new migration.
 */
export const EMBEDDING_DIMENSIONS = 1536;

const BATCH_SIZE = 100;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Embed texts in input order. Throws on API failure so callers can surface
 * the error rather than silently storing nothing.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await getClient().embeddings.create({
      model,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    for (const item of response.data) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
