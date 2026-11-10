import type { Contact } from '@/types';
import { lastSubject, sentSubjects } from '@/utils/interactions';

/**
 * The one-tap reconnect draft, the part that needs no model: the facts on
 * record and a plain draft assembled from them. The server uses it when no
 * model is configured or the model call fails; the rail uses it when the
 * server cannot answer at all, so a card always ends in an email.
 */

export interface ReconnectDraft {
  subject: string;
  body: string;
  /** Written by the model, or assembled from the facts. */
  source: 'model' | 'template';
  /** Why the template was used, when it was. */
  reason?: 'no-model' | 'model-failed';
}

export interface DraftContext {
  contact: Contact;
  userName: string;
  daysSince: number;
  /** True when no conversation is on record; the silence then counts from when the contact was added. */
  neverTouched?: boolean;
  /** The pair's typical gap in days, when known. */
  typicalDays?: number;
}

export const MAX_SUBJECT = 80;
export const MAX_BODY = 700;

/**
 * Clean multi-line text: control characters out, dashes to commas (the
 * product has no em dashes in its copy and a model loves them), blank runs
 * collapsed. A dash that opens a line, as in a sign-off, simply goes.
 */
export function cleanText(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/(^|\n)[ \t]*[\u2013\u2014]+[ \t]*/g, '$1')
    .replace(/[ \t]*[\u2013\u2014]+[ \t]*/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** One line, for a subject or a fact: as cleanText, with line breaks turned into spaces. */
export function cleanLine(text: string, max: number): string {
  return cleanText(text.replace(/\n/g, ' '), max);
}

/** A first name for a greeting; the fallback when the name is empty or an address. */
export function firstName(name: string | undefined, fallback: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && !first.includes('@') ? first : fallback;
}

/** Durations in words for prose: a day, 9 days, 3 weeks, 4 months, 1 year, 2 years. */
export function sinceWords(days: number): string {
  if (days >= 730) return `${Math.floor(days / 365)} years`;
  if (days >= 365) return '1 year';
  if (days >= 60) return `${Math.floor(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  if (days >= 2) return `${days} days`;
  return days === 1 ? 'a day' : 'less than a day';
}

/** A change is read with the contact as subject ("they moved to Berlin"); said to them it is "you moved to Berlin". */
export function secondPerson(text: string): string {
  return text.replace(/^they are\b/i, 'you are').replace(/^they\b/i, 'you').replace(/^their\b/i, 'your').replace(/^them\b/i, 'you');
}

/** "Re: " once, never "Re: Re:"; "Catching up" when there is no subject to pick up. */
export function replySubject(subject: string | undefined): string {
  if (!subject?.trim()) return 'Catching up';
  const base = cleanLine(subject, MAX_SUBJECT);
  return cleanLine(/^re:\s*/i.test(base) ? base : `Re: ${base}`, MAX_SUBJECT);
}

function silenceFact(ctx: DraftContext): string {
  if (ctx.neverTouched) return `Silence: no conversation on record, on your radar for ${sinceWords(ctx.daysSince)}`;
  const usual = ctx.typicalDays ? `, against a usual gap of ${sinceWords(Math.round(ctx.typicalDays))}` : '';
  return `Silence: ${sinceWords(ctx.daysSince)}${usual}`;
}

/** The facts the draft may use, one per line, for the model and for the template alike. */
export function draftFacts(ctx: DraftContext): string[] {
  const { contact } = ctx;
  const facts = [`Contact: ${cleanLine(contact.name || contact.email, 80)}`];
  if (contact.company) facts.push(`Company: ${cleanLine(contact.company, 80)}`);
  if (contact.metAt) facts.push(`Where you met: ${cleanLine(contact.metAt, 120)}`);
  if (contact.introducedBy) facts.push(`Introduced by: ${cleanLine(contact.introducedBy, 80)}`);
  facts.push(silenceFact(ctx));
  const subjects = sentSubjects(contact, 5).map(i => `${String(i.date).slice(0, 10)}: ${cleanLine(i.subject ?? '', 120)}`);
  if (subjects.length) facts.push(`Recent subject lines you sent:\n${subjects.join('\n')}`);
  if (contact.notes?.trim()) facts.push(`Your notes: ${cleanLine(contact.notes, 400)}`);
  if (contact.memory?.summary) facts.push(`Summary from your emails: ${cleanLine(contact.memory.summary, 240)}`);
  for (const loop of contact.memory?.openLoops ?? []) {
    facts.push(`Open loop (${loop.date}): ${loop.who === 'you' ? 'you promised to' : 'they promised to'} ${cleanLine(loop.text, 140)}`);
  }
  for (const change of contact.memory?.changes ?? []) {
    facts.push(`Changed lately (${change.date}): ${cleanLine(change.text, 120)}`);
  }
  return facts;
}

/** A draft assembled from the facts: the opener names one real thing, the ask is easy, the sign-off is the user's first name. */
export function draftFromTemplate(ctx: DraftContext, reason: 'no-model' | 'model-failed' = 'no-model'): ReconnectDraft {
  const { contact } = ctx;
  const to = firstName(contact.name, 'there');
  const me = firstName(ctx.userName, '');
  const since = sinceWords(ctx.daysSince);
  const loop = contact.memory?.openLoops[0];
  const change = contact.memory?.changes[0];
  const subject = lastSubject(contact);
  const met = contact.metAt ? cleanLine(contact.metAt, 80) : '';

  let opener: string;
  if (loop?.who === 'you') {
    opener = `I said I would ${cleanLine(loop.text, 140)}, and I have not forgotten.`;
  } else if (loop?.who === 'them') {
    opener = `You mentioned you would ${cleanLine(loop.text, 140)}. No rush at all, I just wanted to check whether that is still on your plate.`;
  } else if (change) {
    opener = `I saw that ${secondPerson(cleanLine(change.text, 120))}, and did not want to let it pass without saying hello.`;
  } else if (subject) {
    opener = `It has been ${since} since we last traded notes about "${cleanLine(subject, 80)}", and I did not want to let it go longer.`;
  } else if (ctx.neverTouched && met) {
    opener = `We met at ${met} and I never followed up properly, which I would like to fix.`;
  } else if (ctx.neverTouched) {
    opener = 'I have been meaning to reach out properly for a while and did not want to let it go longer.';
  } else if (met) {
    opener = `It has been ${since} since we met at ${met}, and I did not want to let it go longer.`;
  } else {
    opener = `It has been ${since} since we last spoke, and I did not want to let it go longer.`;
  }

  const body = [`Hi ${to},`, '', opener, '', 'Would you be up for a quick catch-up in the next couple of weeks?', '', me].join('\n').trim();
  return { subject: replySubject(subject), body: cleanText(body, MAX_BODY), source: 'template', reason };
}

/** Clip and clean whatever the model returned; the template when it is unusable. */
export function sanitizeDraft(raw: unknown, ctx: DraftContext): ReconnectDraft {
  const data = (raw && typeof raw === 'object' ? raw : {}) as { subject?: unknown; body?: unknown };
  const subject = typeof data.subject === 'string' ? cleanLine(data.subject, MAX_SUBJECT) : '';
  const body = typeof data.body === 'string' ? cleanText(data.body, MAX_BODY) : '';
  if (!body) return draftFromTemplate(ctx, 'model-failed');
  return { subject: subject || 'Catching up', body, source: 'model' };
}
