import type { Contact } from '@/types';
import { computeReconnectQueue, type ReconnectCandidate } from '@/utils/reconnect';

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
  count: number;
}

const DIGEST_SIZE = 5;

function since(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  if (days >= 14) return `${Math.round(days / 7)}w`;
  return `${days}d`;
}

/** Names and subjects come from mail headers: never trust them inside HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rhythmLine(candidate: ReconnectCandidate): string {
  if (candidate.neverTouched) return `Added ${since(candidate.daysSince)} ago, no touch yet`;
  if (candidate.cadence.source === 'pair') {
    return `Usually every ${since(Math.round(candidate.cadence.typicalDays))}, quiet for ${since(candidate.daysSince)}`;
  }
  return `Last touch ${since(candidate.daysSince)} ago`;
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
  const queue = computeReconnectQueue(contacts, { limit: DIGEST_SIZE, priorityEmails });
  const count = queue.length;
  const first = (userName ?? '').trim().split(/\s+/)[0];
  const greeting = first && !first.includes('@') ? `Hi ${first},` : 'Hi,';
  const subject = count === 0
    ? 'Nobody is going cold this week'
    : `Going cold this week: ${count} ${count === 1 ? 'person' : 'people'}`;
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/contacts` : null;

  const textLines: string[] = [greeting, ''];
  const htmlItems: string[] = [];
  if (count === 0) {
    textLines.push('Nobody is going cold against their own rhythm this week. Nothing to do.');
  } else {
    textLines.push(`${count} ${count === 1 ? 'relationship is' : 'relationships are'} going cold against ${count === 1 ? 'its' : 'their'} own rhythm. One line of context each:`, '');
    for (const candidate of queue) {
      const c = candidate.contact;
      const where = c.company ? ` (${c.company})` : '';
      const loop = loopLine(candidate);
      textLines.push(`${candidate.priority ? '* ' : ''}${c.name}${where}`);
      textLines.push(`  ${rhythmLine(candidate)}${candidate.lastSubject ? ` · last: "${candidate.lastSubject}"` : ''}`);
      if (loop) textLines.push(`  ${loop}`);
      textLines.push(`  Email: ${c.email}`, '');
      htmlItems.push(
        `<li style="margin:0 0 14px 0;">` +
          `<div style="font-weight:600;color:#1E1E3F;">${candidate.priority ? '&#10022; ' : ''}${escapeHtml(c.name)}${where ? `<span style="font-weight:400;color:#6B7280;">${escapeHtml(where)}</span>` : ''}</div>` +
          `<div style="color:#6B7280;font-size:13px;">${escapeHtml(rhythmLine(candidate))}${candidate.lastSubject ? ` &middot; last: &ldquo;${escapeHtml(candidate.lastSubject)}&rdquo;` : ''}</div>` +
          (loop ? `<div style="color:#1E1E3F;font-size:13px;">${escapeHtml(loop)}</div>` : '') +
          `<div style="font-size:13px;"><a href="mailto:${escapeHtml(c.email)}" style="color:#4B4BA6;">Email ${escapeHtml(c.name.split(' ')[0] || c.name)}</a></div>` +
        `</li>`
      );
    }
    if (link) textLines.push(`Draft an opener for any of them in Node: ${link}`, '');
  }
  textLines.push('You get this every Monday because you asked for it; turn it off on the Insights page.');

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F4FF;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;">` +
    `<p style="margin:0 0 12px 0;color:#1E1E3F;">${escapeHtml(greeting)}</p>` +
    (count === 0
      ? `<p style="color:#374151;">Nobody is going cold against their own rhythm this week. Nothing to do.</p>`
      : `<p style="color:#374151;">${count} ${count === 1 ? 'relationship is' : 'relationships are'} going cold against ${count === 1 ? 'its' : 'their'} own rhythm. One line of context each:</p>` +
        `<ul style="list-style:none;padding:0;margin:16px 0;">${htmlItems.join('')}</ul>` +
        (link ? `<p style="font-size:13px;"><a href="${escapeHtml(link)}" style="color:#4B4BA6;">Draft an opener for any of them in Node</a></p>` : '')) +
    `<p style="margin:20px 0 0 0;color:#9CA3AF;font-size:12px;">You get this every Monday because you asked for it; turn it off on the Insights page.</p>` +
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
  });
  if (!response.ok) return { ok: false, reason: `resend ${response.status}` };
  return { ok: true };
}
