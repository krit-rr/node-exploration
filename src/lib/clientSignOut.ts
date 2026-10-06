'use client';

import { signOut } from 'next-auth/react';

/**
 * Sign out AND purge the user-scoped browser state. Mailbox-derived contact
 * data must not survive sign-out on a shared machine; next-auth's signOut
 * only clears the session cookie.
 */
export async function signOutAndPurge(userEmail?: string | null): Promise<void> {
  try {
    if (userEmail) {
      for (const prefix of ['contacts_', 'contact-groups_', 'contact-filter_', 'enrichment-cache_']) {
        localStorage.removeItem(`${prefix}${userEmail}`);
      }
      localStorage.removeItem(`cleanup-shown-in-session-${userEmail}`);
      sessionStorage.removeItem(`cleanup-state_${userEmail}`);
    }
    // Legacy un-scoped flags from older versions
    for (const key of ['cleanup_just_closed', 'force_show_cleanup', 'sentRecipients_loaded_from_cache', 'contact-groups']) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error('Failed to clear local data on sign-out:', error);
  }
  await signOut({ callbackUrl: '/' });
}
