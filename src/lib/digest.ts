import type { Contact } from '@/types';
import { cadenceStatus, computeReconnectQueue, type ReconnectCandidate } from '@/utils/reconnect';
import { firstName } from '@/utils/draft';
import { digestSubject } from '@/utils/digestSubject';

/**
 * The Monday digest: the going-cold five, one line of context each, in
 * the inbox, because a queue only works if it finds you. Built from the
 * same queue the app shows, so the email and the rail never disagree.
 * Opt-in only; sent by the cron route to the digest_subscribers rows.
 */

export interface Digest {
  subject: string;
  text: string;
  html: string;
  /** Everyone going cold this week, not only the five in the body. */
  count: number;
}

/** The five furthest past their rhythm go in the body; the count is the whole queue. */
export const DIGEST_SIZE = 5;
/** The queue is bounded like the insights page's count. */
const QUEUE_LIMIT = 50;

/** Names and subjects come from mail headers: never trust them inside HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A mailto link for an address from a mail header. Anything that could
 * smuggle parameters into the link (a query, a fragment, whitespace,
 * quotes) means no link at all; the address is still printed as text.
 */
export function mailtoHref(email: string): string | null {
  return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) ? `mailto:${encodeURIComponent(email)}` : null;
}

function loopLine(candidate: ReconnectCandidate): string | null {
  const loop = candidate.contact.memory?.openLoops[0];
  if (!loop) return null;
  return `${loop.who === 'you' ? 'You promised' : 'They promised'}: ${loop.text}`;
}

export function buildDigest({
  contacts,
  priorityEmails,
  userName,
  appUrl,
}: {
  contacts: Contact[];
  priorityEmails?: Set<string>;
  userName?: string | null;
  appUrl?: string | null;
}): Digest {
  const queue = computeReconnectQueue(contacts, { limit: QUEUE_LIMIT, priorityEmails });
  const count = queue.length;
  const shown = queue.slice(0, DIGEST_SIZE);
  const first = firstName(userName ?? '', '');
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const subject = digestSubject(count);
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/contacts` : null;
  const intro = count === 1
    ? '1 relationship is going cold against its own rhythm. One line of context:'
    : count > DIGEST_SIZE
      ? `${count} relationships are going cold against their own rhythm. The ${DIGEST_SIZE} furthest past it, one line of context each:`
      : `${count} relationships are going cold against their own rhythm. One line of context each:`;

  const textLines: string[] = [greeting, ''];
  const htmlItems: string[] = [];
  if (count === 0) {
    textLines.push('Nobody is going cold against their own rhythm this week. Nothing to do.');
  } else {
    textLines.push(intro, '');
    for (const candidate of shown) {
      const c = candidate.contact;
      const where = c.company ? ` (${c.company})` : '';
      const loop = loopLine(candidate);
      const href = mailtoHref(c.email);
      textLines.push(`${candidate.priority ? '* ' : ''}${c.name}${where}`);
      textLines.push(`  ${cadenceStatus(candidate)}${candidate.lastSubject ? ` · last: "${candidate.lastSubject}"` : ''}`);
      if (loop) textLines.push(`  ${loop}`);
      textLines.push(`  Email: ${c.email}`, '');
      htmlItems.push(
        `<li style="margin:0 0 14px 0;">` +
          `<div style="font-weight:600;color:#1E1E3F;">${candidate.priority ? '&#10022; ' : ''}${escapeHtml(c.name)}${where ? `<span style="font-weight:400;color:#6B7280;">${escapeHtml(where)}</span>` : ''}</div>` +
          `<div style="color:#6B7280;font-size:13px;">${escapeHtml(cadenceStatus(candidate))}${candidate.lastSubject ? ` &middot; last: &ldquo;${escapeHtml(candidate.lastSubject)}&rdquo;` : ''}</div>` +
          (loop ? `<div style="color:#1E1E3F;font-size:13px;">${escapeHtml(loop)}</div>` : '') +
          (href
            ? `<div style="font-size:13px;"><a href="${escapeHtml(href)}" style="color:#4B4BA6;">Email ${escapeHtml(firstName(c.name, 'them'))}</a></div>`
            : `<div style="font-size:13px;color:#6B7280;">${escapeHtml(c.email)}</div>`) +
        `</li>`
      );
    }
    if (link) textLines.push(`Draft an opener for any of them in Node: ${link}`, '');
  }
  textLines.push('You get this every Monday because you asked for it. Turn it off on the Insights page.');

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F4FF;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;">` +
    `<p style="margin:0 0 12px 0;color:#1E1E3F;">${escapeHtml(greeting)}</p>` +
    (count === 0
      ? `<p style="color:#374151;">Nobody is going cold against their own rhythm this week. Nothing to do.</p>`
      : `<p style="color:#374151;">${escapeHtml(intro)}</p>` +
        `<ul style="list-style:none;padding:0;margin:16px 0;">${htmlItems.join('')}</ul>` +
        (link ? `<p style="font-size:13px;"><a href="${escapeHtml(link)}" style="color:#4B4BA6;">Draft an opener for any of them in Node</a></p>` : '')) +
    `<p style="margin:20px 0 0 0;color:#9CA3AF;font-size:12px;">You get this every Monday because you asked for it. Turn it off on the Insights page.</p>` +
    `</div></body></html>`;

  return { subject, text: textLines.join('\n'), html, count };
}

/** Send through Resend's REST API. Returns why it did not send instead of throwing. */
export async function sendDigestEmail({
  to,
  digest,
}: {
  to: string;
  digest: Digest;
}): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM;
  if (!apiKey || !from) return { ok: false, reason: 'not-configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: digest.subject, text: digest.text, html: digest.html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { ok: false, reason: `resend ${response.status}` };
  return { ok: true };
}
