import OpenAI from 'openai';

export type Enrichment = { company: string | null; industry: string | null };

// Free/consumer mail providers. Never worth an AI call: the answer is always "personal".
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me',
  'pm.me', 'hey.com', 'fastmail.com', 'zoho.com', 'gmx.com', 'gmx.de',
  'mail.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com',
]);

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

// The prompt receives ONLY the domain: the local part of an email address is
// attacker-controlled free text and was a prompt-injection vector into the
// shared cross-user enrichment cache.
function buildPrompt(domain: string): string {
  return `Analyze this email domain and determine if it's a personal email provider or a business domain.

For personal email providers (like gmail.com, yahoo.com, etc.), return exactly:
Company:
Industry:

For business domains, return exactly:
Company: Company Name
Industry: Industry Name

Domain: ${domain}

Rules:
1. For personal emails, leave both fields blank (just the labels)
2. For business emails, provide the actual company name and industry
3. Do not include any explanatory text
4. Do not include brackets or placeholder text
5. If unsure, treat as a personal email provider and leave fields blank
6. Do not include the word "Industry" in the company field
7. Do not include any additional text or formatting`;
}

function normalize(value?: string | null): string | null {
  if (!value) return null;

  const cleaned = value.trim();
  const lower = cleaned.toLowerCase();

  // Check for empty or placeholder values
  if (
    cleaned === '' ||
    lower.includes('leave blank') ||
    cleaned.includes('[') ||
    cleaned.includes(']') ||
    lower.includes('personal') ||
    lower.includes('unknown') ||
    lower.includes('n/a') ||
    lower === 'none' ||
    lower.includes('industry') // Additional check for "industry" in company field
  ) {
    return null;
  }

  return cleaned;
}

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
 * Ask the model for company/industry for an email address.
 *
 * Throws on API failure so callers can retry. Returns {null, null} for
 * personal addresses or when the model declines to answer.
 */
export async function enrichViaAI(email: string): Promise<Enrichment> {
  const domain = email.split('@')[1] ?? '';
  if (!domain || isPersonalDomain(domain)) {
    return { company: null, industry: null };
  }

  const completion = await getClient().chat.completions.create({
    model: process.env.OPENAI_ENRICH_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that analyzes email addresses to determine company and industry information. You must respond in the exact format specified, with no additional text or explanations.',
      },
      { role: 'user', content: buildPrompt(domain) },
    ],
    temperature: 0,
    max_tokens: 100,
  });

  const result = completion.choices[0]?.message?.content || '';

  // Extract company and industry using regex, ensuring proper line breaks
  const companyMatch = result.match(/^Company:\s*(.*?)(?:\n|$)/im);
  const industryMatch = result.match(/^Industry:\s*(.*?)(?:\n|$)/im);

  return {
    company: normalize(companyMatch?.[1]),
    industry: normalize(industryMatch?.[1]),
  };
}
