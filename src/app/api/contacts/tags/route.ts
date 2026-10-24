import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { bulkAddTag } from '@/lib/contactsStore';

const MAX_EMAILS = 500;

/** POST /api/contacts/tags: add one tag to many contacts at once. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { emails, tag } = await request.json();
    if (
      !Array.isArray(emails) || emails.length === 0 || emails.length > MAX_EMAILS ||
      !emails.every((e) => typeof e === 'string' && e.includes('@')) ||
      typeof tag !== 'string' || !tag.trim() || tag.length > 50
    ) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }

    try {
      const result = await bulkAddTag(session.user.email.toLowerCase(), emails, tag.trim());
      return NextResponse.json({ persisted: result.available, updated: result.updated });
    } catch (error) {
      console.error('Bulk tag persistence failed:', error);
      return NextResponse.json({ persisted: false, updated: 0 });
    }
  } catch (error) {
    console.error('Error bulk tagging:', error);
    return NextResponse.json({ error: 'Failed to tag contacts' }, { status: 500 });
  }
}
