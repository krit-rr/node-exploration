import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Contact } from '@/types';
import { updateContact } from '@/lib/contactsStore';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PUT /api/contacts/[email] — update one contact, addressed by its ORIGINAL
 * email, so editing the email field updates the row instead of forking a
 * duplicate. Falls back to the old echo behavior while the store is
 * unprovisioned (client-side localStorage remains the cache either way).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ email: string }> }
): Promise<Response> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email } = await context.params;
    const originalEmail = decodeURIComponent(email);
    const updatedContact: Contact = await request.json();

    if (!updatedContact?.email || !EMAIL_RE.test(updatedContact.email)) {
      return NextResponse.json({ error: 'Invalid contact email' }, { status: 400 });
    }

    try {
      const result = await updateContact(
        session.user.email.toLowerCase(),
        originalEmail,
        updatedContact
      );
      if (result.available && result.contact) {
        return NextResponse.json({ ...result.contact, persisted: true }, { status: 200 });
      }
    } catch (error) {
      console.error('Contact store write failed, echoing unpersisted update:', error);
    }

    return NextResponse.json(updatedContact, { status: 200 });
  } catch (error) {
    console.error('Error updating contact:', error);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}
