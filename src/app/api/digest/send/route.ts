import { NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { buildDigest, sendDigestEmail } from '@/lib/digest';
import { listDigestSubscribers, markDigestSent, type DigestSubscriber } from '@/lib/digestStore';

/** Vercel's longest function budget on every plan; the run stays inside it by mailing three owners at a time. */
export const maxDuration = 60;
const CONCURRENCY = 3;
/** A digest is weekly: a re-run inside this window (a retry, a second scheduler) sends nothing twice. */
const RESEND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * GET or POST /api/digest/send: mail the Monday digest to everyone who
 * opted in. Vercel calls the cron in vercel.json with GET and the bearer
 * secret from CRON_SECRET; any scheduler can call either method the same
 * way. Skips people with nobody going cold, and people already mailed this
 * week unless ?force=1. Each owner is independent: one failure never stops
 * the rest.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM) {
    return NextResponse.json({ error: 'Digest email is not configured' }, { status: 503 });
  }
  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const subscribers = await listDigestSubscribers();
    if (!subscribers.available) {
      return NextResponse.json({ sent: 0, skipped: 0, alreadySent: 0, failed: 0, persisted: false });
    }
    const now = Date.now();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
    const counts = { sent: 0, skipped: 0, alreadySent: 0, failed: 0 };
    const limit = pLimit(CONCURRENCY);

    const mailOne = async ({ owner, lastSentAt }: DigestSubscriber) => {
      const last = lastSentAt ? new Date(lastSentAt).getTime() : NaN;
      if (!force && !Number.isNaN(last) && now - last < RESEND_AFTER_MS) {
        counts.alreadySent++;
        return;
      }
      try {
        const [stored, groups] = await Promise.all([listContacts(owner), listGroups(owner)]);
        const priorityEmails = new Set(groups.groups.flatMap((g) => g.members.map((m) => m.toLowerCase())));
        const digest = buildDigest({ contacts: stored.contacts, priorityEmails, appUrl });
        if (digest.count === 0) {
          counts.skipped++;
          return;
        }
        const result = await sendDigestEmail({ to: owner, digest });
        if (!result.ok) {
          counts.failed++;
          console.error(`Digest not sent to one subscriber: ${result.reason}`);
          return;
        }
        counts.sent++;
        try {
          await markDigestSent(owner);
        } catch (error) {
          // The email went out; only the record of it did not. Say so rather than hide it.
          console.error('Digest sent but not recorded for one subscriber:', error);
        }
      } catch (error) {
        counts.failed++;
        console.error('Digest failed for one subscriber:', error);
      }
    };

    await Promise.all(subscribers.subscribers.map((subscriber) => limit(() => mailOne(subscriber))));
    return NextResponse.json({ ...counts, persisted: true });
  } catch (error) {
    console.error('Digest run failed:', error);
    return NextResponse.json({ error: 'Digest run failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
