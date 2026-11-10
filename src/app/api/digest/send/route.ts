import { NextResponse } from 'next/server';
import { listContacts } from '@/lib/contactsStore';
import { listGroups } from '@/lib/groupsStore';
import { buildDigest, sendDigestEmail } from '@/lib/digest';
import { listDigestSubscribers, markDigestSent } from '@/lib/digestStore';

/**
 * POST /api/digest/send: mail the Monday digest to everyone who opted in.
 * Called by the scheduler (vercel.json runs it Monday 13:00 UTC) with the
 * bearer secret Vercel attaches when CRON_SECRET is set; any scheduler
 * can call it the same way. Skips people with nobody going cold.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM) {
    return NextResponse.json({ error: 'Digest email is not configured' }, { status: 503 });
  }

  try {
    const subscribers = await listDigestSubscribers();
    if (!subscribers.available) {
      return NextResponse.json({ sent: 0, skipped: 0, failed: 0, persisted: false });
    }
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
    for (const owner of subscribers.owners) {
      try {
        const [stored, groups] = await Promise.all([listContacts(owner), listGroups(owner)]);
        const priorityEmails = new Set(groups.groups.flatMap((g) => g.members.map((m) => m.toLowerCase())));
        const digest = buildDigest({ contacts: stored.contacts, priorityEmails, appUrl });
        if (digest.count === 0) {
          skipped++;
          continue;
        }
        const result = await sendDigestEmail({ to: owner, digest });
        if (result.ok) {
          sent++;
          await markDigestSent(owner);
        } else {
          failed++;
          console.error(`Digest not sent to one subscriber: ${result.reason}`);
        }
      } catch (error) {
        failed++;
        console.error('Digest failed for one subscriber:', error);
      }
    }
    return NextResponse.json({ sent, skipped, failed, persisted: true });
  } catch (error) {
    console.error('Digest run failed:', error);
    return NextResponse.json({ error: 'Digest run failed' }, { status: 500 });
  }
}
