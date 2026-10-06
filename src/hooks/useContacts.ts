'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Contact } from '@/types';
import { adaptContacts } from '@/utils/contactAdapter';

export type ContactsData = {
  contacts: Contact[];
  lastUpdated: string;
};

// Helper function to get the consistent storage key
export const getContactsStorageKey = (userEmail: string | null | undefined): string => {
  if (!userEmail) {
    throw new Error('User email is required for storage key');
  }
  return `contacts_${userEmail}`;
};

/**
 * Write the canonical persisted shape and return the matching query-cache
 * value. Every cache writer must go through this (or produce the identical
 * shape): the queryFn validates userEmail and expects
 * { contacts, lastUpdated, userEmail } in localStorage.
 */
export function persistContacts(userEmail: string, contacts: Contact[]): ContactsData {
  const lastUpdated = new Date().toISOString();
  try {
    localStorage.setItem(
      getContactsStorageKey(userEmail),
      JSON.stringify({ contacts, lastUpdated, userEmail })
    );
  } catch (error) {
    console.error('Failed to persist contacts to localStorage:', error);
  }
  return { contacts, lastUpdated };
}

/** Read and validate the local cache; returns null when unusable. */
function readCachedContacts(userEmail: string): ContactsData | null {
  try {
    const cachedData = localStorage.getItem(getContactsStorageKey(userEmail));
    if (!cachedData) return null;
    const parsedData = JSON.parse(cachedData);
    if (!parsedData || typeof parsedData !== 'object') return null;
    if (parsedData.userEmail && parsedData.userEmail !== userEmail) return null;
    const contacts = Array.isArray(parsedData)
      ? parsedData
      : Array.isArray(parsedData.contacts)
        ? parsedData.contacts
        : null;
    if (!contacts) return null;
    return {
      contacts: adaptContacts(contacts),
      lastUpdated: parsedData.lastUpdated || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

/**
 * Re-pull from the mail provider and merge into the server store
 * (GET /api/contacts?sync=1), then update the local cache.
 */
export async function syncContacts(userEmail: string): Promise<ContactsData> {
  const response = await fetch('/api/contacts?sync=1');
  if (!response.ok) {
    throw new Error('Failed to sync contacts');
  }
  const data = await response.json();
  const rawContacts = data.contacts || [];
  const { lastUpdated } = persistContacts(userEmail, rawContacts);
  return { contacts: adaptContacts(rawContacts), lastUpdated };
}

/**
 * The one contacts query: a single key, shape, and fetcher shared by every
 * page. The server store is authoritative; localStorage is an offline cache.
 */
export function useContacts() {
  const { data: session } = useSession();

  return useQuery<ContactsData>(
    ['sentRecipients', session?.user?.email],
    async () => {
      // Ensure we have a valid session
      if (!session?.user?.email) {
        throw new Error('No active session');
      }
      const userEmail = session.user.email;

      // Network first: the server store is the source of truth. localStorage
      // is only an offline/fast-boot cache, written on every successful fetch.
      try {
        const response = await fetch('/api/contacts');
        if (!response.ok) {
          throw new Error('Failed to fetch contacts');
        }
        const data = await response.json();
        const rawContacts = data.contacts || [];
        const { lastUpdated } = persistContacts(userEmail, rawContacts);
        return {
          contacts: adaptContacts(rawContacts),
          lastUpdated
        };
      } catch (networkError) {
        const cached = readCachedContacts(userEmail);
        if (cached) {
          toast('Offline: showing locally cached contacts', {
            duration: 3000,
            position: 'bottom-right',
            style: { backgroundColor: '#F4F4FF', color: '#1E1E3F' }
          });
          return cached;
        }
        throw networkError;
      }
    },
    {
      enabled: !!session?.user?.email,
      staleTime: 30 * 60 * 1000, // 30 minutes
      cacheTime: 60 * 60 * 1000, // keep in memory at least as long as it stays fresh
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false
    }
  );
}
